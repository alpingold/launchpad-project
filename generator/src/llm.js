// Talking to the model: Purdue GenAI Studio's OpenAI-compatible chat API, with plain fetch.
//
// Inside the OpenShell sandbox, GENAI_API_KEY holds only a placeholder; OpenShell's proxy
// swaps in the real key on the way to genai.rcac.purdue.edu (generator/README.md).

const DEFAULT_BASE_URL = 'https://genai.rcac.purdue.edu/api';
const CALL_TIMEOUT_MS = 5 * 60 * 1000; // slow models can take minutes
// GenAI Studio allows 20 requests a minute and may answer `null` when you go over;
// waiting a little and trying again is what its docs recommend.
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

/**
 * @typedef {{ role: 'system' | 'user' | 'assistant', content: string }} Message
 * @typedef {{ content: string, seconds: number, usage: object | null }} ChatResult
 */

/**
 * Sends a conversation to the model and returns its reply.
 * @param {Message[]} messages
 * @param {Object} opts
 * @param {string} opts.model
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.apiKey]
 * @param {typeof fetch} [opts.fetchImpl]          tests pass a fake
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {(text: string) => void} [opts.onRetry]
 * @returns {Promise<ChatResult>}
 */
export async function chat(
  messages,
  {
    model,
    baseUrl = process.env.GENAI_BASE_URL || DEFAULT_BASE_URL,
    apiKey = process.env.GENAI_API_KEY,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onRetry = () => {},
  },
) {
  let lastProblem = '';
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const wait = RETRY_DELAYS_MS[attempt - 1];
      onRetry(`model call failed (${lastProblem}); trying again in ${wait / 1000} s`);
      await sleep(wait);
    }
    const started = Date.now();
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      lastProblem = err.cause?.code ?? err.name ?? 'network error';
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastProblem = `HTTP ${res.status}`;
      continue;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // 4xx other than 429 won't get better by retrying (bad model name, bad key, ...).
      throw new Error(`model call failed: HTTP ${res.status} ${JSON.stringify(body)?.slice(0, 300)}`);
    }
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      lastProblem = 'empty reply (often the rate limit)';
      continue;
    }
    return { content, seconds: Math.round((Date.now() - started) / 1000), usage: body.usage ?? null };
  }
  throw new Error(`model call failed after ${RETRY_DELAYS_MS.length + 1} tries: ${lastProblem}`);
}

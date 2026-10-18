// Talking to the model: Purdue GenAI Studio's OpenAI-compatible chat API, with plain fetch.
//
// Inside the OpenShell sandbox, GENAI_API_KEY holds only a placeholder; OpenShell's proxy
// swaps in the real key on the way to genai.rcac.purdue.edu (generator/README.md).
//
// The reply is STREAMED: it arrives piece by piece as the model writes it (its thinking too,
// as `reasoning_content`). So there's no limit on how long a reply may take, only on SILENCE:
// a call that sends nothing for IDLE_TIMEOUT_MS is stuck, and is tried again. (Until
// 2026-10-15 a call had 5 minutes in total, which cut off healthy but long replies.)

import { MODELS } from './models.js';

const DEFAULT_BASE_URL = 'https://genai.rcac.purdue.edu/api';
/** No new piece of the reply for this long: the call is stuck. (Pieces normally come every few ms.) */
export const IDLE_TIMEOUT_MS = 2 * 60 * 1000;
/** How often the progress callback hears how far the reply has got. */
const PROGRESS_EVERY_MS = 15_000;
// GenAI Studio allows 20 requests a minute and may answer `null` when you go over;
// waiting a little and trying again is what its docs recommend.
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

/**
 * @typedef {{ role: 'system' | 'user' | 'assistant', content: string }} Message
 * @typedef {{ content: string, thinking: string, seconds: number, usage: object | null }} ChatResult
 * @typedef {{ thinking: number, writing: number }} Progress  pieces received so far (about one token each)
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
 * @param {(progress: Progress) => void} [opts.onProgress]  every ~15 s while the reply streams in
 * @param {number} [opts.idleTimeoutMs]
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
    onProgress = () => {},
    idleTimeoutMs = IDLE_TIMEOUT_MS,
  },
) {
  const reasoningEffort = MODELS.find((m) => m.id === model)?.reasoningEffort;
  const body = JSON.stringify({
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
  });
  let lastProblem = '';
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const wait = RETRY_DELAYS_MS[attempt - 1];
      onRetry(`model call failed (${lastProblem}); trying again in ${wait / 1000} s`);
      await sleep(wait);
    }
    const started = Date.now();
    const idle = idleTimer(idleTimeoutMs);
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: idle.signal,
      });
    } catch (err) {
      idle.stop();
      lastProblem = idle.timedOut ? `no answer for ${idleTimeoutMs / 1000} s` : (err.cause?.code ?? err.name ?? 'network error');
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      idle.stop();
      lastProblem = `HTTP ${res.status}`;
      continue;
    }
    if (!res.ok) {
      idle.stop();
      // 4xx other than 429 won't get better by retrying (bad model name, bad key, too long...).
      const body = await res.json().catch(() => null);
      throw new Error(`model call failed: HTTP ${res.status} ${JSON.stringify(body)?.slice(0, 300)}`);
    }

    let reply;
    try {
      reply = isEventStream(res) ? await readStream(res, idle, onProgress) : await readWhole(res);
    } catch (err) {
      lastProblem = idle.timedOut ? `the reply stopped for ${idleTimeoutMs / 1000} s` : `the reply broke off (${err.name ?? 'error'})`;
      continue;
    } finally {
      idle.stop();
    }
    if (typeof reply.content !== 'string' || reply.content === '') {
      lastProblem = 'empty reply (often the rate limit)';
      continue;
    }
    return { content: reply.content, thinking: reply.thinking, seconds: Math.round((Date.now() - started) / 1000), usage: reply.usage };
  }
  throw new Error(`model call failed after ${RETRY_DELAYS_MS.length + 1} tries: ${lastProblem}`);
}

/** An abort signal that fires after `ms` of silence; `touch()` restarts the wait. */
function idleTimer(ms) {
  const controller = new AbortController();
  const timer = {
    signal: controller.signal,
    timedOut: false,
    handle: null,
    touch() {
      clearTimeout(timer.handle);
      timer.handle = setTimeout(() => {
        timer.timedOut = true;
        controller.abort();
      }, ms);
    },
    stop() {
      clearTimeout(timer.handle);
    },
  };
  timer.touch();
  return timer;
}

function isEventStream(res) {
  return /text\/event-stream/i.test(res.headers?.get?.('content-type') ?? '');
}

/** A server that ignores `stream: true` answers with one JSON body. */
async function readWhole(res) {
  const body = await res.json().catch(() => null);
  const message = body?.choices?.[0]?.message;
  return { content: message?.content, thinking: message?.reasoning_content ?? '', usage: body?.usage ?? null };
}

/**
 * Reads a streamed reply: lines of `data: {json}`, ending with `data: [DONE]`. Each chunk
 * holds a small piece of the reply (`delta.content`) or of the model's thinking
 * (`delta.reasoning_content`); the last one carries the token counts.
 */
async function readStream(res, idle, onProgress) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  const thoughts = [];
  const progress = { thinking: 0, writing: 0 };
  let usage = null;
  let buffer = '';
  let reportedAt = Date.now();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    idle.touch();
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue; // a broken line: skip it
      }
      const delta = chunk.choices?.[0]?.delta ?? {};
      if (typeof delta.content === 'string' && delta.content) {
        parts.push(delta.content);
        progress.writing += 1;
      }
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        thoughts.push(delta.reasoning_content);
        progress.thinking += 1;
      }
      if (chunk.usage) usage = chunk.usage;
    }
    if (Date.now() - reportedAt >= PROGRESS_EVERY_MS) {
      reportedAt = Date.now();
      onProgress({ ...progress });
    }
  }
  return { content: parts.join(''), thinking: thoughts.join(''), usage };
}

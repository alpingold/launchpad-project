/**
 * Talking to the model: one small interface, as email is (mail.ts). The real client speaks to
 * Purdue's GenAI Studio; a scripted fake (fake-model.ts) answers in development, the browser tests
 * and every unit test. Nothing in the tests or scripts reaches the internet.
 *
 * The Creator's own key is passed on each call and goes nowhere but the request's authorization
 * header: never into a log line, an error, or what a call answers.
 */
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { COMPLETION_TIMEOUT_MS, KEY_CHECK_TIMEOUT_MS, MAX_ANSWER_BYTES } from "./numbers.js";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/**
 * How a call can fail, each something the Creator can be told (story 32):
 * - keyRejected: GenAI Studio refused the key (401, 403). Check the key.
 * - rateLimited: it is busy with this key (429, or a `null` answer, which is how it says so).
 * - unavailable: anything else: no connection, a timeout, another status, an answer that isn't the
 *   expected JSON, a web page, a redirect.
 */
export type ModelFailure = "keyRejected" | "rateLimited" | "unavailable";

export type Completion = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly failure: ModelFailure };

export interface CompleteOptions {
  /** Gives the call up (a cancelled Generation): it then fails as unavailable, at once. */
  readonly signal?: AbortSignal;
}

export interface Model {
  /** Asks the model, with the Creator's key, and returns its whole answer or how it failed. It never throws. */
  complete(key: string, messages: readonly ChatMessage[], options?: CompleteOptions): Promise<Completion>;
  /** Whether GenAI Studio takes this key: "valid", or how the check failed. */
  checkKey(key: string): Promise<"valid" | ModelFailure>;
}

export interface GenaiOptions {
  /** Where GenAI Studio's API is, such as https://genai.rcac.purdue.edu/api. From the settings only. */
  readonly baseUrl: string;
  /** Which model to ask. */
  readonly model: string;
  /** COMPLETION_TIMEOUT_MS unless a test wants less. */
  readonly completionTimeoutMs?: number;
  /** KEY_CHECK_TIMEOUT_MS unless a test wants less. */
  readonly keyCheckTimeoutMs?: number;
}

type Answer = { readonly status: number; readonly body: string } | { readonly failed: true };

/**
 * One request, with `node:http` or `node:https` rather than fetch: GenAI Studio sends nothing, not
 * even its headers, until its whole answer is written, which takes minutes, and fetch gives up after
 * 5 minutes without headers and can't be told otherwise without a dependency. Redirects are never
 * followed (these modules don't), so a key is never sent anywhere but the configured address.
 */
function send(url: URL, method: "GET" | "POST", key: string, body: string | undefined, timeoutMs: number, signal?: AbortSignal): Promise<Answer> {
  return new Promise((resolve) => {
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;
    const finish = (answer: Answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
      resolve(answer);
    };
    const abort = () => {
      outgoing?.destroy();
      finish({ failed: true });
    };
    if (signal?.aborted === true) return finish({ failed: true });
    const make = url.protocol === "https:" ? httpsRequest : httpRequest;
    let outgoing: ReturnType<typeof make> | undefined;
    try {
      outgoing = makeRequest();
    } catch {
      // A header Node won't send (a key holding a line break or a character it can't write) throws
      // here, naming only the header. It is a failure like any other, never an exception.
      return finish({ failed: true });
    }
    signal?.addEventListener("abort", abort, { once: true });
    // The whole call, headers and answer, within the time; the error (if any) carries no key, and
    // is never passed on anyway: only "failed".
    deadline = setTimeout(() => {
      outgoing?.destroy();
      finish({ failed: true });
    }, timeoutMs);
    outgoing.on("error", () => finish({ failed: true }));
    outgoing.end(body);

    function makeRequest() {
      return make(
      url,
      {
        method,
        // A connection of its own, not one kept from a shared pool: a call is minutes long, and a
        // pool's own timeouts must have no say in when it gives up.
        agent: false,
        headers: {
          authorization: `Bearer ${key}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(body) }),
        },
      },
      (response: IncomingMessage) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_ANSWER_BYTES) {
            response.destroy();
            return finish({ failed: true });
          }
          chunks.push(chunk);
        });
        response.on("end", () => finish({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", () => finish({ failed: true }));
      },
      );
    }
  });
}

function failureOf(status: number): ModelFailure {
  if (status === 401 || status === 403) return "keyRejected";
  if (status === 429) return "rateLimited";
  return "unavailable";
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** The real client, for GenAI Studio's OpenAI-style API. */
export function genaiModel(options: GenaiOptions): Model {
  const base = options.baseUrl.replace(/\/+$/, "");
  return {
    async complete(key, messages, call = {}) {
      const body = JSON.stringify({ model: options.model, messages, stream: false });
      const answer = await send(new URL(`${base}/chat/completions`), "POST", key, body, options.completionTimeoutMs ?? COMPLETION_TIMEOUT_MS, call.signal);
      if ("failed" in answer) return { ok: false, failure: "unavailable" };
      if (answer.status !== 200) return { ok: false, failure: failureOf(answer.status) };
      const parsed = parseJson(answer.body);
      if (!parsed.ok) return { ok: false, failure: "unavailable" };
      // GenAI Studio answers a busy key with a body of `null` and status 200.
      if (parsed.value === null) return { ok: false, failure: "rateLimited" };
      const content = (parsed.value as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
      if (typeof content !== "string") return { ok: false, failure: "unavailable" };
      return { ok: true, text: content };
    },
    async checkKey(key) {
      const answer = await send(new URL(`${base}/models`), "GET", key, undefined, options.keyCheckTimeoutMs ?? KEY_CHECK_TIMEOUT_MS);
      if ("failed" in answer) return "unavailable";
      if (answer.status !== 200) return failureOf(answer.status);
      const parsed = parseJson(answer.body);
      if (!parsed.ok || parsed.value === null) return parsed.ok ? "rateLimited" : "unavailable";
      return Array.isArray((parsed.value as { data?: unknown }).data) ? "valid" : "unavailable";
    },
  };
}

// --- Reading an answer -----------------------------------------------------------------------------

/** The answer without the model's thinking (`<think>...</think>`), which some models write first. */
export function withoutThinking(text: string): string {
  // Each <think>...</think>, and a <think> never closed (all of the rest is thinking).
  if (text.includes("<think>")) return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
  // Some models leave out the opening tag: everything up to the first </think> is thinking.
  return text.replace(/^[\s\S]*?<\/think>/, "").trim();
}

/** The longest fenced code block in the answer (```ts ... ```), or undefined if it has none. */
export function longestCodeBlock(text: string): string | undefined {
  let longest: string | undefined;
  for (const match of withoutThinking(text).matchAll(/```[^\n`]*\n([\s\S]*?)```/g)) {
    const code = match[1] ?? "";
    if (longest === undefined || code.length > longest.length) longest = code;
  }
  return longest;
}

/** The answer from its first `{` to its last `}`, for a Concept, or undefined if it has no braces. */
export function jsonObjectText(text: string): string | undefined {
  const plain = withoutThinking(text);
  const first = plain.indexOf("{");
  const last = plain.lastIndexOf("}");
  return first === -1 || last < first ? undefined : plain.slice(first, last + 1);
}

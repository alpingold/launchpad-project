// The real model client, against a small server each test starts on this machine (plain http, which
// only development allows): every kind of answer GenAI Studio can give, and that the Creator's key
// goes nowhere but the authorization header. Nothing here reaches the internet.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { modelFrom } from "../config.js";
import { ScriptedModel } from "./fake-model.js";
import { genaiModel, jsonObjectText, longestCodeBlock, withoutThinking, type ChatMessage, type Model } from "./model.js";
import { MAX_ANSWER_BYTES } from "./numbers.js";

const KEY = "sk-test-key-9f8e7d6c5b4a";
const MESSAGES: ChatMessage[] = [
  { role: "system", content: "You write party games." },
  { role: "user", content: "Make one." },
];

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: string;
}

let servers: Server[];
let logged: string[];

beforeEach(() => {
  servers = [];
  logged = [];
  for (const method of ["log", "warn", "error", "info", "debug"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  // The key is never written to a log, whatever happened in the test.
  for (const line of logged) expect(line).not.toContain(KEY);
});

/** A stand-in GenAI Studio that answers each request with `answer`, and records what it was sent. */
async function stand(answer: (request: IncomingMessage, response: ServerResponse) => void): Promise<{ base: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      seen.push({ method: request.method ?? "", url: request.url ?? "", authorization: request.headers.authorization, body });
      answer(request, response);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`, seen };
}

const json = (status: number, value: unknown) => (_request: IncomingMessage, response: ServerResponse) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

const client = (base: string, times: { completionTimeoutMs?: number; keyCheckTimeoutMs?: number } = {}): Model => genaiModel({ baseUrl: base, model: "test-model", ...times });

describe("asking the model", () => {
  test("a good answer: its text, from a POST to <base>/chat/completions with the model, the messages, no streaming, and the key as a bearer token", async () => {
    const { base, seen } = await stand(json(200, { choices: [{ message: { role: "assistant", content: "Here is a Game." } }] }));
    expect(await client(base).complete(KEY, MESSAGES)).toEqual({ ok: true, text: "Here is a Game." });
    expect(seen).toEqual([{ method: "POST", url: "/api/chat/completions", authorization: `Bearer ${KEY}`, body: JSON.stringify({ model: "test-model", messages: MESSAGES, stream: false }) }]);
  });

  test.each([
    [401, "keyRejected"],
    [403, "keyRejected"],
    [429, "rateLimited"],
    [500, "unavailable"],
    [502, "unavailable"],
    [404, "unavailable"],
  ] as const)("status %i: %s", async (status, failure) => {
    const { base } = await stand(json(status, { error: "no" }));
    expect(await client(base).complete(KEY, MESSAGES)).toEqual({ ok: false, failure });
  });

  test("a body of null with status 200, which is how GenAI Studio says it is busy: rateLimited", async () => {
    const { base } = await stand(json(200, null));
    expect(await client(base).complete(KEY, MESSAGES)).toEqual({ ok: false, failure: "rateLimited" });
  });

  test("a web page with status 200: unavailable", async () => {
    const { base } = await stand((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>Maintenance</title><p>Back soon</p>");
    });
    expect(await client(base).complete(KEY, MESSAGES)).toEqual({ ok: false, failure: "unavailable" });
  });

  test("JSON that isn't an answer: unavailable", async () => {
    const { base } = await stand(json(200, { choices: [] }));
    expect(await client(base).complete(KEY, MESSAGES)).toEqual({ ok: false, failure: "unavailable" });
  });

  test("a redirect is a failure, never followed: the key goes nowhere else", async () => {
    const elsewhere = await stand(json(200, { choices: [{ message: { content: "stolen" } }] }));
    const { base } = await stand((_request, response) => {
      response.writeHead(307, { location: `${elsewhere.base}/chat/completions` });
      response.end();
    });
    expect(await client(base).complete(KEY, MESSAGES)).toEqual({ ok: false, failure: "unavailable" });
    expect(elsewhere.seen).toEqual([]);
  });

  // Longer than the 5 seconds a pooled socket of Node's own may sit silent: a call has a connection
  // of its own, and only its own deadline decides. (fetch's 5 minutes without headers can't be
  // waited out in a test; the client doesn't use fetch.)
  test("headers that arrive only after a long silence are waited for: GenAI Studio writes nothing until its answer is ready", { timeout: 20_000 }, async () => {
    const { base } = await stand((request, response) => setTimeout(() => json(200, { choices: [{ message: { content: "Slow but here." } }] })(request, response), 6_500));
    expect(await client(base, { completionTimeoutMs: 15_000 }).complete(KEY, MESSAGES)).toEqual({ ok: true, text: "Slow but here." });
  });

  test("an answer that stops after its headers: unavailable, once the time is up", async () => {
    const { base } = await stand((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"choices": [');
    });
    expect(await client(base, { completionTimeoutMs: 400 }).complete(KEY, MESSAGES)).toEqual({ ok: false, failure: "unavailable" });
  });

  test("an answer larger than the client reads: unavailable", async () => {
    const { base } = await stand((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "x".repeat(MAX_ANSWER_BYTES) } }] }));
    });
    expect(await client(base).complete(KEY, MESSAGES)).toEqual({ ok: false, failure: "unavailable" });
  });

  test("a key Node can't put in a header is a failure, never an exception, and the failure holds no key", async () => {
    const { base, seen } = await stand(json(200, { data: [] }));
    const broken = `${KEY}\r\nx-injected: 1`;
    const asked = await client(base).complete(broken, MESSAGES);
    expect(asked).toEqual({ ok: false, failure: "unavailable" });
    expect(await client(base).checkKey(broken)).toBe("unavailable");
    expect(seen).toEqual([]);
  });

  test("a call can be given up: it fails at once, and one given up before it starts sends nothing", async () => {
    const { base, seen } = await stand(() => undefined);
    const giveUp = new AbortController();
    const asking = client(base, { completionTimeoutMs: 60_000 }).complete(KEY, MESSAGES, { signal: giveUp.signal });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    giveUp.abort();
    expect(await asking).toEqual({ ok: false, failure: "unavailable" });
    const already = new AbortController();
    already.abort();
    expect(await client(base).complete(KEY, MESSAGES, { signal: already.signal })).toEqual({ ok: false, failure: "unavailable" });
    expect(seen).toHaveLength(1);
  });

  test("a connection that never answers: unavailable, once the time is up", async () => {
    const { base } = await stand(() => undefined);
    const started = Date.now();
    expect(await client(base, { completionTimeoutMs: 300 }).complete(KEY, MESSAGES)).toEqual({ ok: false, failure: "unavailable" });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  test("nothing listening: unavailable", async () => {
    const { base } = await stand(() => undefined);
    const closed = servers.pop()!;
    closed.closeAllConnections();
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect(await client(base).complete(KEY, MESSAGES)).toEqual({ ok: false, failure: "unavailable" });
  });

  test("the key is in no answer and no failure the client gives back", async () => {
    const answers = [json(401, { error: `bad key ${KEY}` }), json(200, { choices: [{ message: { content: "fine" } }] }), json(500, { echo: KEY })];
    for (const answer of answers) {
      const { base } = await stand(answer);
      expect(JSON.stringify(await client(base).complete(KEY, MESSAGES))).not.toContain(KEY);
    }
  });
});

describe("checking a key", () => {
  test("valid only when <base>/models answers JSON with a list in data", async () => {
    const good = await stand(json(200, { data: [{ id: "test-model" }] }));
    expect(await client(good.base).checkKey(KEY)).toBe("valid");
    expect(good.seen).toEqual([{ method: "GET", url: "/api/models", authorization: `Bearer ${KEY}`, body: "" }]);
    for (const body of [{ data: "x" }, { models: [] }, []]) expect(await client((await stand(json(200, body))).base).checkKey(KEY)).toBe("unavailable");
  });

  test("refused, busy, or a web page", async () => {
    expect(await client((await stand(json(401, {}))).base).checkKey(KEY)).toBe("keyRejected");
    expect(await client((await stand(json(403, {}))).base).checkKey(KEY)).toBe("keyRejected");
    expect(await client((await stand(json(200, null))).base).checkKey(KEY)).toBe("rateLimited");
    expect(await client((await stand(json(429, {}))).base).checkKey(KEY)).toBe("rateLimited");
    const page = await stand((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html></html>");
    });
    expect(await client(page.base).checkKey(KEY)).toBe("unavailable");
  });

  test("within its time: one that never answers is unavailable", async () => {
    const { base } = await stand(() => undefined);
    expect(await client(base, { keyCheckTimeoutMs: 300 }).checkKey(KEY)).toBe("unavailable");
  });
});

describe("reading an answer", () => {
  test("the model's thinking is dropped", () => {
    expect(withoutThinking("<think>I should make a\\nGame</think>\nHere it is.")).toBe("Here it is.");
    expect(withoutThinking("Still thinking then</think> done")).toBe("done");
    // Never closed: all of the rest is thinking.
    expect(withoutThinking("Answer first. <think>and then thinking ```ts\nx\n```")).toBe("Answer first.");
    // A "</think>" inside the answer's own code, after the thinking, doesn't take the code with it.
    expect(withoutThinking('<think>hm</think>\n```ts\nconst tag = "</think>";\n```')).toBe('```ts\nconst tag = "</think>";\n```');
  });

  test("code: the longest fenced block, thinking aside", () => {
    const answer = "<think>```ts\nconst thinking = 1;\n// longer than the answer's code, but only thinking\n```</think>\nSmall:\n```\nx\n```\nThe file:\n```ts\nexport default 1;\n```";
    expect(longestCodeBlock(answer)).toBe("export default 1;\n");
    expect(longestCodeBlock("no code here")).toBeUndefined();
  });

  test("a Concept: from the first { to the last }", () => {
    expect(jsonObjectText('Sure! {"title": "A", "x": {"y": 1}} Hope that helps.')).toBe('{"title": "A", "x": {"y": 1}}');
    expect(jsonObjectText("no braces")).toBeUndefined();
  });
});

describe("which model the settings ask for", () => {
  test("none: the AI maker is off", () => {
    expect(modelFrom({})).toBeNull();
    expect(modelFrom({ NODE_ENV: "production" })).toBeNull();
  });

  test("fake: the scripted fake, refused in production", () => {
    expect(modelFrom({ GENAI_BASE_URL: "fake" })).toBeInstanceOf(ScriptedModel);
    expect(() => modelFrom({ GENAI_BASE_URL: "fake", NODE_ENV: "production" })).toThrow(/production/);
  });

  test("an address and a model: GenAI Studio; plain http only outside production", () => {
    expect(modelFrom({ GENAI_BASE_URL: "https://genai.example/api", GENAI_MODEL: "m", NODE_ENV: "production" })).not.toBeNull();
    expect(modelFrom({ GENAI_BASE_URL: "http://127.0.0.1:9/api", GENAI_MODEL: "m" })).not.toBeNull();
    expect(() => modelFrom({ GENAI_BASE_URL: "http://genai.example/api", GENAI_MODEL: "m", NODE_ENV: "production" })).toThrow(/https/);
    expect(() => modelFrom({ GENAI_BASE_URL: "ftp://genai.example/api", GENAI_MODEL: "m" })).toThrow(/https/);
  });

  test("one without the other, or an address that isn't one, stops the server from starting", () => {
    expect(() => modelFrom({ GENAI_BASE_URL: "https://genai.example/api" })).toThrow(/together/);
    expect(() => modelFrom({ GENAI_MODEL: "m" })).toThrow(/together/);
    expect(() => modelFrom({ GENAI_BASE_URL: "not a url", GENAI_MODEL: "m" })).toThrow(/address/);
  });
});

// A Creator's GenAI Studio key, over real HTTP: saved only once the (fake) GenAI Studio accepts it,
// encrypted, and never sent back: every answer the site gives is searched for it.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { IN_MEMORY, openDatabase, type Database } from "../db/database.js";
import { storedKey } from "../db/genai-keys.js";
import { createServer, RecordedMail, type RunningServer } from "../index.js";
import type { Clock } from "../rooms.js";
import { ScriptedModel } from "./fake-model.js";
import { KEY_PATH, MAKER_OFF } from "./key-routes.js";
import { keySecretFrom, keySecretFromBytes, SECRET_BYTES, type KeySecret } from "./key-secret.js";
import { KEY_SAVES } from "./numbers.js";

const SITE = "https://boilergames.test";
const KEY = "sk-genai-0123456789abcdefWXYZ";

class FakeClock implements Clock {
  time = 1_800_000_000_000;
  now = () => this.time;
  setTimeout = () => () => undefined;
}

let root: string;
let db: Database;
let mail: RecordedMail;
let model: ScriptedModel;
let server: RunningServer;
let base: string;
/** Every answer's text, so a test can search all of them for the key. */
let answers: string[];
let logged: string[];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "keys-"));
  await mkdir(join(root, "client"));
  await mkdir(join(root, "games"));
  await writeFile(join(root, "client/index.html"), "<!doctype html><title>BoilerGames</title>");
  await writeFile(join(root, "games/games.json"), "[]");
});
afterAll(async () => {
  await rm(root, { recursive: true });
});

const secretOf = (byte: number) => keySecretFromBytes(Buffer.alloc(SECRET_BYTES, byte));

async function start(options: { model?: ScriptedModel | null; keySecret?: KeySecret | null } = {}): Promise<void> {
  server = createServer({
    clientDist: join(root, "client"),
    gamesDist: join(root, "games"),
    siteOrigin: SITE,
    frameUrl: "https://play.test/v1/",
    clock: new FakeClock(),
    mail,
    database: db,
    model: options.model === undefined ? model : options.model,
    keySecret: options.keySecret === undefined ? secretOf(7) : options.keySecret,
  });
  await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  db = openDatabase({ file: IN_MEMORY, log: () => undefined });
  mail = new RecordedMail();
  model = new ScriptedModel([], { rejectedKeys: ["sk-rejected-key-0000"] });
  answers = [];
  logged = [];
  for (const method of ["log", "warn", "error", "info"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  await start();
});
afterEach(async () => {
  await server.close();
  db.close();
  vi.restoreAllMocks();
  for (const text of [...answers, ...logged]) expect(text).not.toContain(KEY);
});

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(method === "GET" ? {} : { origin: SITE, "content-type": "application/json" }), ...(options.cookie === undefined ? {} : { cookie: options.cookie }) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  answers.push(text, JSON.stringify([...response.headers]));
  return { status: response.status, body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>) };
}

async function signIn(email: string): Promise<{ cookie: string; id: string }> {
  await call("POST", "/api/sign-in", { body: { email } });
  const token = new URL(/https:\S+/.exec(mail.sent.at(-1)?.text ?? "")?.[0] ?? "").hash.slice(1);
  const response = await fetch(`${base}/api/sign-in/confirm`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ token }) });
  const cookie = response.headers.getSetCookie()[0]?.split(";")[0] ?? "";
  const named = await call("POST", "/api/me/display-name", { body: { displayName: email.split("@")[0] }, cookie });
  return { cookie, id: (named.body["account"] as { id: string }).id };
}

describe("saving a key", () => {
  test("checked with GenAI Studio first, then saved encrypted; the site shows only its last 4 characters", async () => {
    const ada = await signIn("ada@purdue.edu");
    expect(await call("GET", KEY_PATH, { cookie: ada.cookie })).toEqual({ status: 200, body: { saved: false } });
    const saved = await call("PUT", KEY_PATH, { body: { key: `  ${KEY}  ` }, cookie: ada.cookie });
    expect(saved).toEqual({ status: 200, body: { saved: true, last4: "WXYZ", savedAt: 1_800_000_000 } });
    expect(model.keyChecks).toEqual([KEY]);
    expect(await call("GET", KEY_PATH, { cookie: ada.cookie })).toEqual({ status: 200, body: { saved: true, last4: "WXYZ", savedAt: 1_800_000_000 } });
    // Encrypted in the database: the key's text is nowhere in the row.
    const row = storedKey(db, ada.id);
    expect(Buffer.from(row!.sealed.ciphertext).toString("utf8")).not.toContain(KEY);
    expect(secretOf(7).open(ada.id, row!.sealed)).toBe(KEY);
  });

  test("a key GenAI Studio refuses isn't saved, and the Creator is told; so is a busy or unreachable GenAI Studio", async () => {
    const ada = await signIn("ada@purdue.edu");
    expect(await call("PUT", KEY_PATH, { body: { key: "sk-rejected-key-0000" }, cookie: ada.cookie })).toEqual({ status: 400, body: { error: expect.stringContaining("didn't accept that key") } });
    for (const failure of ["rateLimited", "unavailable"] as const) {
      model.checkKey = async () => failure;
      expect((await call("PUT", KEY_PATH, { body: { key: KEY }, cookie: ada.cookie })).status).toBe(503);
    }
    expect(storedKey(db, ada.id)).toBeUndefined();
  });

  test("something that isn't a key is refused before GenAI Studio is asked", async () => {
    const ada = await signIn("ada@purdue.edu");
    for (const key of ["short", "has a space in it", "line\r\nbreak-0000000", "x".repeat(501), 42]) {
      expect((await call("PUT", KEY_PATH, { body: { key }, cookie: ada.cookie })).status).toBe(400);
    }
    expect(model.keyChecks).toEqual([]);
  });

  test(`at most ${KEY_SAVES} tries in 15 minutes for one account`, async () => {
    const ada = await signIn("ada@purdue.edu");
    for (let n = 0; n < KEY_SAVES; n += 1) expect((await call("PUT", KEY_PATH, { body: { key: KEY }, cookie: ada.cookie })).status).toBe(200);
    expect((await call("PUT", KEY_PATH, { body: { key: KEY }, cookie: ada.cookie })).status).toBe(429);
  });

  test("signed out, sign in first; a key is each account's own", async () => {
    expect((await call("GET", KEY_PATH)).status).toBe(401);
    expect((await call("PUT", KEY_PATH, { body: { key: KEY } })).status).toBe(401);
    const ada = await signIn("ada@purdue.edu");
    const bo = await signIn("bo@purdue.edu");
    await call("PUT", KEY_PATH, { body: { key: KEY }, cookie: ada.cookie });
    expect((await call("GET", KEY_PATH, { cookie: bo.cookie })).body).toEqual({ saved: false });
  });
});

test("deleting a key: gone from the database", async () => {
  const ada = await signIn("ada@purdue.edu");
  await call("PUT", KEY_PATH, { body: { key: KEY }, cookie: ada.cookie });
  expect(await call("DELETE", KEY_PATH, { body: {}, cookie: ada.cookie })).toEqual({ status: 200, body: { saved: false } });
  expect(storedKey(db, ada.id)).toBeUndefined();
});

describe("the encryption", () => {
  test("a row copied to another account won't decrypt", async () => {
    const ada = await signIn("ada@purdue.edu");
    const bo = await signIn("bo@purdue.edu");
    await call("PUT", KEY_PATH, { body: { key: KEY }, cookie: ada.cookie });
    const row = storedKey(db, ada.id)!;
    expect(secretOf(7).open(bo.id, row.sealed)).toBeUndefined();
  });

  test("another secret, or a changed row, fails cleanly: no key and no error", () => {
    const sealed = secretOf(7).seal("ada", KEY);
    expect(secretOf(8).open("ada", sealed)).toBeUndefined();
    const changed = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext).map((byte, at) => (at === 0 ? byte ^ 1 : byte)) };
    expect(secretOf(7).open("ada", changed)).toBeUndefined();
  });

  test("each saving uses a new nonce, so the same key never looks the same twice", () => {
    const one = secretOf(7).seal("ada", KEY);
    const two = secretOf(7).seal("ada", KEY);
    expect(Buffer.from(one.nonce).equals(Buffer.from(two.nonce))).toBe(false);
    expect(Buffer.from(one.ciphertext).equals(Buffer.from(two.ciphertext))).toBe(false);
  });

  test("the secret from KEY_SECRET_FILE: 64 hexadecimal characters, or the server won't start", async () => {
    const file = join(root, "secret");
    await writeFile(file, `${"ab".repeat(32)}\n`);
    const secret = keySecretFrom({ KEY_SECRET_FILE: file });
    expect(secret?.open("ada", secret.seal("ada", KEY))).toBe(KEY);
    expect(keySecretFrom({})).toBeNull();
    await writeFile(file, "too short");
    expect(() => keySecretFrom({ KEY_SECRET_FILE: file })).toThrow(/64 hexadecimal/);
    expect(() => keySecretFrom({ KEY_SECRET_FILE: join(root, "missing") })).toThrow(/can't be read/);
  });
});

describe("with the AI maker off", () => {
  test.each([
    ["no model", { model: null }],
    ["no key secret", { keySecret: null }],
  ] as const)("%s: /api/config says so, and saving is refused; seeing and deleting still work", async (_what, options) => {
    await server.close();
    await start(options);
    expect((await call("GET", "/api/config")).body["aiMaker"]).toBe(false);
    const ada = await signIn("ada@purdue.edu");
    expect(await call("PUT", KEY_PATH, { body: { key: KEY }, cookie: ada.cookie })).toEqual({ status: 503, body: { error: MAKER_OFF } });
    expect((await call("GET", KEY_PATH, { cookie: ada.cookie })).status).toBe(200);
    expect((await call("DELETE", KEY_PATH, { body: {}, cookie: ada.cookie })).status).toBe(200);
  });

  test("with both, it is on", async () => {
    expect((await call("GET", "/api/config")).body["aiMaker"]).toBe(true);
  });
});

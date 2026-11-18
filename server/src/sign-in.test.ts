// Accounts and signing in, through the whole server over real HTTP, with a fake clock, a database
// in memory and the emails recorded.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createServer, IN_MEMORY, openDatabase, RecordedMail, type Database, type RunningServer } from "./index.js";
import type { Clock } from "./rooms.js";
import {
  displayName,
  EMAILS_PER_ADDRESS,
  EMAILS_PER_DAY,
  EMAILS_PER_VISITOR_PER_HOUR,
  purdueEmail,
  SESSION_MS,
  SIGN_IN_LINK_MS,
  WRONG_LINKS_PER_MINUTE,
} from "./sign-in.js";

const SITE = "https://boilergames.test";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

class FakeClock implements Clock {
  time = Date.UTC(2026, 10, 18);
  #timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  now = () => this.time;
  setTimeout = (run: () => void, ms: number) => {
    const timer = { at: this.time + ms, run, cancelled: false };
    this.#timers.push(timer);
    return () => void (timer.cancelled = true);
  };
  advance(ms: number): void {
    const until = this.time + ms;
    for (;;) {
      const due = this.#timers.filter((t) => !t.cancelled && t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.time = due.at;
      due.cancelled = true;
      due.run();
    }
    this.time = until;
  }
}

let root: string;
let clock: FakeClock;
let mail: RecordedMail;
let db: Database;
let server: RunningServer;
let base: string;
/** Every line the server wrote to the console during a test. */
let logged: string[];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "sign-in-"));
  await mkdir(join(root, "client"));
  await mkdir(join(root, "games"));
  await writeFile(join(root, "client/index.html"), "<!doctype html><title>BoilerGames</title>");
  await writeFile(join(root, "games/games.json"), "[]");
});
afterAll(async () => {
  await rm(root, { recursive: true });
});

beforeEach(async () => {
  clock = new FakeClock();
  mail = new RecordedMail();
  db = openDatabase({ file: IN_MEMORY, log: () => undefined });
  logged = [];
  for (const method of ["log", "warn", "error", "info"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  server = createServer({
    clientDist: join(root, "client"),
    gamesDist: join(root, "games"),
    siteOrigin: SITE,
    frameUrl: "https://play.boilergames.test/v1/",
    clock,
    mail,
    database: db,
    // The visitor's address, as the per-visitor limits see it: a test names it in a header.
    addressOf: (request) => String(request.headers["x-test-visitor"] ?? "visitor-1"),
  });
  await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await server.close();
  db.close();
  vi.restoreAllMocks();
});

interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly text: string;
  readonly cookies: string[];
  readonly headers: Headers;
}

/** A request as one of the site's pages makes it, unless `headers` says otherwise. */
async function call(method: string, path: string, options: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(method === "GET" ? {} : { origin: SITE, "content-type": "application/json" }),
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Not JSON: a page.
  }
  return { status: response.status, body, text, cookies: response.headers.getSetCookie(), headers: response.headers };
}

/** Asks for a sign-in email and returns the token in its link. */
async function askForLink(email: string, visitor = "visitor-1"): Promise<string> {
  const reply = await call("POST", "/api/sign-in", { body: { email }, headers: { "x-test-visitor": visitor } });
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  const link = /https:\S+/.exec(mail.sent.at(-1)?.text ?? "")?.[0] ?? "";
  return new URL(link).hash.slice(1);
}

/** Presses the button on the link's page. Returns the reply and the session cookie, as "name=value". */
async function press(token: string, visitor = "visitor-1"): Promise<{ reply: Reply; cookie: string }> {
  const reply = await call("POST", "/api/sign-in/confirm", { body: { token }, headers: { "x-test-visitor": visitor } });
  return { reply, cookie: reply.cookies[0]?.split(";")[0] ?? "" };
}

async function signIn(email: string): Promise<string> {
  const { reply, cookie } = await press(await askForLink(email));
  expect(reply.status).toBe(200);
  return cookie;
}

async function me(cookie: string): Promise<Record<string, unknown> | null> {
  return (await call("GET", "/api/me", { cookie })).body["account"] as Record<string, unknown> | null;
}

describe("who may sign in", () => {
  test("only @purdue.edu addresses, trimmed and in lower case, and without a +tag", () => {
    expect(purdueEmail("  Ada.Lovelace@Purdue.EDU ")).toEqual({ ok: true, email: "ada.lovelace@purdue.edu" });
    expect(purdueEmail("a@purdue.edu")).toEqual({ ok: true, email: "a@purdue.edu" });
    for (const other of ["ada@gmail.com", "ada@alumni.purdue.edu", "ada@purdue.edu.evil.example", "ada@purdue.education", "purdue.edu", "ada@purdue_edu"]) {
      expect(purdueEmail(other), other).toEqual({ ok: false, error: "Only Purdue email addresses (ending in @purdue.edu) can sign in for now." });
    }
    expect(purdueEmail("ada+games@purdue.edu")).toEqual({ ok: false, error: "Use your Purdue address without a +tag." });
    for (const odd of ["@purdue.edu", ".ada@purdue.edu", "a b@purdue.edu", "ada\n@purdue.edu", "\"ada\"@purdue.edu"]) expect(purdueEmail(odd).ok, odd).toBe(false);
  });

  test("another address is refused with a message that says why, and no email is sent", async () => {
    const reply = await call("POST", "/api/sign-in", { body: { email: "ada@gmail.com" } });
    expect(reply.status).toBe(400);
    expect(reply.body["error"]).toMatch(/Only Purdue email addresses/);
    expect(mail.sent).toEqual([]);
  });
});

describe("signing in", () => {
  test("the email holds a link to the confirm page with the token after the #, says it runs out in 15 minutes and can be ignored", async () => {
    const token = await askForLink("ada@purdue.edu");
    const sent = mail.sent[0];
    expect(sent?.to).toBe("ada@purdue.edu");
    expect(sent?.subject).toBe("Your BoilerGames sign-in link");
    expect(sent?.text).toContain(`${SITE}/sign-in/confirm#${token}`);
    expect(sent?.text).toContain("15 minutes");
    expect(sent?.text).toMatch(/If you didn't ask to sign in, ignore this email/);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("pressing the button signs in with a session cookie the page's scripts can't read, and makes the account, with no display name yet", async () => {
    const { reply, cookie } = await press(await askForLink("ada@purdue.edu"));
    expect(reply.status).toBe(200);
    const set = reply.cookies[0] ?? "";
    expect(set).toMatch(/^__Host-session=[A-Za-z0-9_-]{43};/);
    expect(set).toMatch(/; HttpOnly/);
    expect(set).toMatch(/; Secure/);
    expect(set).toMatch(/; SameSite=Lax/);
    expect(set).toMatch(/; Path=\//);
    expect(set).toMatch(/; Max-Age=7776000/);
    expect(set).not.toMatch(/Domain=/i);
    expect(await me(cookie)).toEqual({ id: expect.any(String), email: "ada@purdue.edu", displayName: null });
  });

  test("signing in again with the same address finds the same account", async () => {
    const first = (await me(await signIn("ada@purdue.edu")))?.["id"];
    const second = (await me(await signIn("ADA@purdue.edu")))?.["id"];
    expect(second).toBe(first);
  });

  test("a link works once", async () => {
    const token = await askForLink("ada@purdue.edu");
    expect((await press(token)).reply.status).toBe(200);
    const again = await press(token);
    expect(again.reply.status).toBe(400);
    expect(again.reply.body["error"]).toMatch(/used or has run out/);
    expect(again.reply.cookies).toEqual([]);
  });

  test("opening the link's page, as a mail scanner does, signs nobody in and uses nothing up", async () => {
    const token = await askForLink("ada@purdue.edu");
    for (const path of ["/sign-in/confirm", `/sign-in/confirm?token=${token}`]) {
      const page = await call("GET", path);
      expect(page.status).toBe(200);
      expect(page.text).toContain("<title>BoilerGames</title>");
      expect(page.cookies).toEqual([]);
    }
    expect((await press(token)).reply.status).toBe(200);
  });

  test("a link works until it is 15 minutes old, and not after", async () => {
    const early = await askForLink("ada@purdue.edu");
    const late = await askForLink("bo@purdue.edu");
    clock.advance(SIGN_IN_LINK_MS - 1000);
    expect((await press(early)).reply.status).toBe(200);
    clock.advance(1000);
    expect((await press(late)).reply.status).toBe(400);
  });

  test("a token nobody was sent signs nobody in", async () => {
    for (const token of ["x".repeat(43), "", "not a token"]) expect((await press(token)).reply.status).toBe(400);
  });

  test("signing out ends the session: the cookie no longer signs in, and the session is gone from the database", async () => {
    const cookie = await signIn("ada@purdue.edu");
    const out = await call("POST", "/api/sign-out", { body: {}, cookie });
    expect(out.status).toBe(200);
    expect(out.cookies[0]).toMatch(/^__Host-session=;/);
    expect(await me(cookie)).toBeNull();
    expect(db.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual(expect.objectContaining({ n: 0 }));
  });

  test("nobody signed in: /api/me says so", async () => {
    expect(await me("")).toBeNull();
    expect(await me("__Host-session=made-up")).toBeNull();
  });

  test("a session lasts 90 days from its last use", async () => {
    const used = await signIn("ada@purdue.edu");
    const unused = await signIn("bo@purdue.edu");
    clock.advance(SESSION_MS - DAY);
    expect(await me(used)).not.toBeNull();
    clock.advance(2 * DAY);
    expect(await me(unused)).toBeNull();
    // Used a day before it would have run out, so it runs 90 days from then.
    expect(await me(used)).not.toBeNull();
    clock.advance(SESSION_MS - 2 * DAY);
    expect(await me(used)).not.toBeNull();
  });

  test("links and sessions that have run out are deleted", async () => {
    await askForLink("ada@purdue.edu");
    await signIn("bo@purdue.edu");
    const count = (table: string) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.["n"];
    expect(count("sign_in_links")).toBe(2);
    expect(count("sessions")).toBe(1);
    clock.advance(SIGN_IN_LINK_MS + 10 * MINUTE);
    expect(count("sign_in_links")).toBe(0);
    clock.advance(SESSION_MS);
    expect(count("sessions")).toBe(0);
    expect(count("accounts")).toBe(1);
  });

  test("the database holds no token, only hashes", async () => {
    const token = await askForLink("ada@purdue.edu");
    const cookie = await signIn("bo@purdue.edu");
    const unusedToken = await askForLink("cy@purdue.edu");
    const secrets = [token, unusedToken, cookie.split("=")[1] ?? ""];
    for (const table of ["accounts", "sign_in_links", "sessions"]) {
      for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
        for (const value of Object.values(row)) for (const secret of secrets) expect(String(value)).not.toContain(secret);
      }
    }
    for (const row of db.prepare("SELECT token_hash FROM sign_in_links UNION ALL SELECT token_hash FROM sessions").all()) expect(row["token_hash"]).toMatch(/^[0-9a-f]{64}$/);
  });

  test("over plain http (development), the cookie is `session`, without Secure: the one difference", async () => {
    const plain = createServer({ clientDist: join(root, "client"), gamesDist: join(root, "games"), siteOrigin: "http://localhost:3000", frameUrl: "http://localhost:3001/v1/", mail });
    await new Promise<void>((resolve) => plain.http.listen(0, "127.0.0.1", resolve));
    try {
      const at = `http://127.0.0.1:${(plain.http.address() as AddressInfo).port}`;
      const post = (path: string, body: unknown) => fetch(`${at}${path}`, { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) });
      await post("/api/sign-in", { email: "ada@purdue.edu" });
      const token = new URL(/http:\S+/.exec(mail.sent.at(-1)?.text ?? "")?.[0] ?? "").hash.slice(1);
      const set = (await post("/api/sign-in/confirm", { token })).headers.getSetCookie()[0] ?? "";
      expect(set).toMatch(/^session=[A-Za-z0-9_-]{43}; Max-Age=7776000; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/);
    } finally {
      await plain.close();
    }
  });
});

describe("display names", () => {
  test("2 to 30 characters, trimmed, with nothing invisible", () => {
    expect(displayName("  Ada  ")).toEqual({ ok: true, name: "Ada", key: "ada" });
    expect(displayName("Zoë")).toEqual({ ok: true, name: "Zoë", key: "zoë" });
    expect(displayName("x".repeat(30)).ok).toBe(true);
    for (const bad of ["A", " A ", "x".repeat(31), "", "Ada\u0000", "Ada\nLovelace", "Ada\u200b", "\u202eadA", "Ad\u0007a"]) expect(displayName(bad).ok, JSON.stringify(bad)).toBe(false);
  });

  test("a name that looks blank is refused: it needs a letter or digit, and blank letters don't count", () => {
    // U+2800 is a blank Braille pattern (a symbol); U+3164 and U+FFA0 are Hangul fillers, which
    // Unicode counts as letters but draws as nothing.
    for (const blank of ["\u2800\u2800", "\u3164\u3164", "\uffa0\uffa0", "..", "!?", "\u2800\u2800\u2800 \u2800"]) {
      expect(displayName(blank).ok, JSON.stringify(blank)).toBe(false);
    }
    expect(displayName("\u2800\u2800")).toEqual({ ok: false, error: "A display name needs at least one letter or digit." });
    expect(displayName("\u3164\u3164")).toEqual({ ok: false, error: "A display name can't hold invisible or control characters." });
    for (const fine of ["42", "Ω!", "李明", "Ada 🎲", "x.y"]) expect(displayName(fine).ok, fine).toBe(true);
  });

  test("a new account picks one; it is unique ignoring case and look-alike forms", async () => {
    const ada = await signIn("ada@purdue.edu");
    const bo = await signIn("bo@purdue.edu");
    const pick = (cookie: string, name: string) => call("POST", "/api/me/display-name", { body: { displayName: name }, cookie });
    expect((await pick(ada, " Ada ")).body["account"]).toEqual(expect.objectContaining({ displayName: "Ada" }));
    expect(await me(ada)).toEqual(expect.objectContaining({ displayName: "Ada" }));
    for (const same of ["ada", "ADA", "Ａｄａ"]) {
      const taken = await pick(bo, same);
      expect(taken.status, same).toBe(409);
      expect(taken.body["error"]).toBe("That display name is taken. Pick another.");
    }
    expect((await pick(bo, "x")).status).toBe(400);
    expect((await pick(bo, "Bo")).status).toBe(200);
    // Ada may change hers, to another form of her own.
    expect((await pick(ada, "ADA")).status).toBe(200);
  });

  test("only someone signed in can pick one", async () => {
    expect((await call("POST", "/api/me/display-name", { body: { displayName: "Ada" } })).status).toBe(401);
  });
});

describe("limits", () => {
  test(`${EMAILS_PER_ADDRESS} sign-in emails to one address in 15 minutes; a refusal says how long to wait`, async () => {
    for (let i = 0; i < EMAILS_PER_ADDRESS; i++) await askForLink("ada@purdue.edu", `visitor-${i}`);
    const refused = await call("POST", "/api/sign-in", { body: { email: "ada@purdue.edu" }, headers: { "x-test-visitor": "visitor-9" } });
    expect(refused.status).toBe(429);
    expect(refused.body["error"]).toBe("Too many sign-in emails have been asked for. Try again in 15 minutes.");
    expect(refused.headers.get("retry-after")).toBe("900");
    expect(mail.sent).toHaveLength(EMAILS_PER_ADDRESS);
    clock.advance(SIGN_IN_LINK_MS);
    await askForLink("ada@purdue.edu", "visitor-9");
  });

  test(`${EMAILS_PER_VISITOR_PER_HOUR} from one visitor's address in an hour`, async () => {
    for (let i = 0; i < EMAILS_PER_VISITOR_PER_HOUR; i++) await askForLink(`p${i}@purdue.edu`);
    const refused = await call("POST", "/api/sign-in", { body: { email: "late@purdue.edu" } });
    expect(refused.status).toBe(429);
    expect(refused.body["error"]).toMatch(/Try again in 60 minutes\.$/);
    expect((await call("POST", "/api/sign-in", { body: { email: "late@purdue.edu" }, headers: { "x-test-visitor": "elsewhere" } })).status).toBe(200);
    clock.advance(60 * MINUTE);
    await askForLink("later@purdue.edu");
  });

  test(`${EMAILS_PER_DAY} in a day from the whole site`, async () => {
    for (let i = 0; i < EMAILS_PER_DAY; i++) await askForLink(`p${i}@purdue.edu`, `visitor-${i}`);
    const refused = await call("POST", "/api/sign-in", { body: { email: "late@purdue.edu" }, headers: { "x-test-visitor": "someone-new" } });
    expect(refused.status).toBe(429);
    expect(refused.body["error"]).toMatch(/Try again in 24 hours\.$/);
    clock.advance(DAY);
    await askForLink("late@purdue.edu", "someone-new");
  });

  test(`${WRONG_LINKS_PER_MINUTE} links that don't work from one address in a minute; then even a right one waits`, async () => {
    const token = await askForLink("ada@purdue.edu");
    for (let i = 0; i < WRONG_LINKS_PER_MINUTE; i++) expect((await press(`wrong-${i}`)).reply.status).toBe(400);
    const refused = await press(token);
    expect(refused.reply.status).toBe(429);
    expect(refused.reply.body["error"]).toBe("Too many sign-in links that didn't work. Try again in 1 minute.");
    expect((await press(token, "elsewhere")).reply.status).toBe(200);
    clock.advance(MINUTE);
    expect((await press("wrong-again")).reply.status).toBe(400);
  });
});

describe("only the site's own pages can change anything", () => {
  /** Every route that changes something, and a path with no route at all: a route added later is guarded too. */
  const CHANGING = ["/api/sign-in", "/api/sign-in/confirm", "/api/sign-out", "/api/me/display-name", "/api/not-a-route-yet"];

  test("a POST, PUT or DELETE from another origin, or with no Origin, is refused before anything is read", async () => {
    const cookie = await signIn("ada@purdue.edu");
    const sentBefore = mail.sent.length;
    for (const path of CHANGING) {
      for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
        for (const origin of ["https://evil.example", "null", "http://boilergames.test", "https://boilergames.test.evil.example", undefined]) {
          const response = await fetch(`${base}${path}`, {
            method,
            headers: { "content-type": "application/json", cookie, ...(origin === undefined ? {} : { origin }) },
            body: JSON.stringify({ email: "bo@purdue.edu", token: "x", displayName: "Hacked" }),
          });
          expect(response.status, `${method} ${path} from ${origin ?? "no origin"}`).toBe(403);
        }
      }
    }
    expect(mail.sent.length).toBe(sentBefore);
    expect(await me(cookie)).toEqual(expect.objectContaining({ displayName: null }));
    expect(await me(cookie)).not.toBeNull();
  });

  test("a change without a JSON body is refused, even from the site", async () => {
    for (const path of CHANGING) {
      const form = await fetch(`${base}${path}`, { method: "POST", headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: "email=ada%40purdue.edu" });
      expect(form.status, path).toBe(415);
      const none = await fetch(`${base}${path}`, { method: "POST", headers: { origin: SITE } });
      expect(none.status, path).toBe(415);
    }
    const broken = await fetch(`${base}/api/sign-in`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: "{not json" });
    expect(broken.status).toBe(400);
    expect(await broken.json()).toEqual({ error: "That request couldn't be read." });
    const huge = await fetch(`${base}/api/sign-in`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ email: "x".repeat(20_000) }) });
    expect(huge.status).toBe(413);
  });

  test("what an account sees is never cached on the way; the rest of /api is as before", async () => {
    const cookie = await signIn("ada@purdue.edu");
    expect((await call("GET", "/api/me", { cookie })).headers.get("cache-control")).toBe("no-store");
    expect((await call("POST", "/api/sign-out", { body: {}, cookie })).headers.get("cache-control")).toBe("no-store");
    expect((await call("GET", "/api/config")).headers.get("cache-control")).toBeNull();
    expect((await call("GET", "/api/games")).headers.get("cache-control")).toBeNull();
  });

  test("reading needs no Origin", async () => {
    expect((await fetch(`${base}/api/me`)).status).toBe(200);
    expect((await fetch(`${base}/api/config`)).status).toBe(200);
  });
});

describe("email addresses stay private", () => {
  test("no response and no log line holds another account's email address", async () => {
    const ada = await signIn("ada@purdue.edu");
    await call("POST", "/api/me/display-name", { body: { displayName: "Ada" }, cookie: ada });
    const bo = await signIn("bo@purdue.edu");
    const replies = [
      await call("POST", "/api/me/display-name", { body: { displayName: "ada" }, cookie: bo }),
      await call("GET", "/api/me", { cookie: bo }),
      await call("POST", "/api/sign-in", { body: { email: "ada@purdue.edu" } }),
      await call("POST", "/api/sign-in", { body: { email: "ada@purdue.edu" } }),
      await call("POST", "/api/sign-in/confirm", { body: { token: "wrong" } }),
    ];
    for (const reply of replies) expect(reply.text).not.toContain("ada@purdue.edu");
    expect(logged.join("\n")).not.toMatch(/@purdue\.edu/);
  });

  test("an email that can't be sent is reported without its address, and its link is gone", async () => {
    const failing = createServer({
      clientDist: join(root, "client"),
      gamesDist: join(root, "games"),
      siteOrigin: SITE,
      frameUrl: "https://play.boilergames.test/v1/",
      database: db,
      mail: { send: () => Promise.reject(new Error("MessageRejected")) },
    });
    await new Promise<void>((resolve) => failing.http.listen(0, "127.0.0.1", resolve));
    try {
      const at = `http://127.0.0.1:${(failing.http.address() as AddressInfo).port}`;
      const reply = await fetch(`${at}/api/sign-in`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ email: "ada@purdue.edu" }) });
      expect(reply.status).toBe(502);
      expect(await reply.text()).not.toContain("ada@purdue.edu");
      expect(logged.join("\n")).toContain("A sign-in email couldn't be sent: MessageRejected");
      expect(logged.join("\n")).not.toContain("ada@purdue.edu");
      expect(db.prepare("SELECT count(*) AS n FROM sign_in_links").get()).toEqual(expect.objectContaining({ n: 0 }));
    } finally {
      await failing.close();
    }
  });
});

// The walls around a Game. A hostile bundle tries every way out of the frame's worker: nothing may
// leave the browser, the endless loop must be caught by the two-second rule, and the Screen page must
// keep working. A hoarding bundle tries every way to pass data to another Game: side by side, one
// after the other, and across a browser restart, nothing may arrive. The servers count requests, so
// "blocked" is proved, not assumed.
//
// Like every browser test, each runs in a fresh profile and in a saved one (see fixtures.ts).
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import type { FrameResult } from "../client/src/screen/game-frame.js";
import { expect, test } from "./fixtures.js";
import type { Harness } from "./harness/harness.js";
import { FRAME, OUTSIDE, SITE } from "./origins.js";

declare global {
  interface Window {
    harness: Harness;
  }
}

/** Every attempt the hostile Game makes, by the name it reports it under. */
const ATTEMPTS = [
  "fetch the site",
  "fetch outside",
  "XMLHttpRequest the site",
  "XMLHttpRequest outside",
  "WebSocket",
  "EventSource",
  "importScripts",
  "WebTransport",
  "navigator.sendBeacon",
  "RTCPeerConnection",
  "indexedDB",
  "caches",
  "cookies",
];

/** Every feature the hoarding Game probes, by the name it reports it under. */
const HOARDS = [
  "caches",
  "caches by every route",
  "Worker by every route",
  "nested Worker",
  "origin private file system",
  "indexedDB",
  "webkitRequestFileSystem",
  "BroadcastChannel",
  "navigator.locks",
  "navigator.serviceWorker",
  "localStorage",
  "sessionStorage",
  "cookieStore",
  "SharedWorker",
];

/** Asked of the storage manager in a frame of its own. */
const STORAGE_MANAGER = ["navigator.storage.estimate", "navigator.storage.persist"];

/** Opens the test Screen page in a browser context. */
async function open(context: BrowserContext): Promise<Page> {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${SITE}/?frame=${encodeURIComponent(`${FRAME}/v1/`)}`);
  await expect(page.locator("body[data-ready=yes]")).toBeAttached();
  return page;
}

async function hits(request: APIRequestContext, origin: string, token: string): Promise<string[]> {
  const all = (await (await request.get(`${origin}/__hits`)).json()) as string[];
  return all.filter((hit) => hit.includes(`/probe/${token}/`));
}

/** Asks the newest frame for its Screen View until none of `names` is pending, and returns its lines by name. */
async function settled(page: Page, playerId: string, names: readonly string[]): Promise<Record<string, string>> {
  let lines: Record<string, string> = {};
  await expect
    .poll(
      async () => {
        lines = await page.evaluate(async (id) => {
          const result = await window.harness.frame!.act(id, {
            type: "report",
          });
          if (result.kind !== "result") return { error: JSON.stringify(result) };
          const out: Record<string, string> = {};
          for (const part of result.views.screen.parts) {
            if (part.kind !== "text") continue;
            const [name, ...rest] = part.text.split(" => ");
            out[name ?? ""] = rest.join(" => ");
          }
          return out;
        }, playerId);
        return names.filter((name) => lines[name] === undefined || lines[name] === "pending");
      },
      { timeout: 10_000 },
    )
    .toEqual([]);
  return lines;
}

/** Like {@link settled}, but a frame that stops answering (Firefox freezes on the storage manager) is reported, not failed. */
async function settledOrFrozen(page: Page, playerId: string, names: readonly string[]): Promise<Record<string, string>> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const result = await page.evaluate((id) => window.harness.frame!.act(id, { type: "report" }), playerId);
    if (result.kind !== "result") return Object.fromEntries(names.map((name) => [name, `the worker froze: ${JSON.stringify(result)}`]));
    const lines: Record<string, string> = {};
    for (const part of result.views.screen.parts) if (part.kind === "text") lines[part.text.split(" => ")[0] ?? ""] = part.text.split(" => ").slice(1).join(" => ");
    if (names.every((name) => lines[name] !== undefined && lines[name] !== "pending") || Date.now() > deadline) return lines;
    await page.waitForTimeout(100);
  }
}

const print = (title: string, lines: Record<string, string>) =>
  console.log(
    `\n${title}\n${Object.entries(lines)
      .map(([name, outcome]) => `  ${name} => ${outcome}`)
      .join("\n")}`,
  );

test("a hostile Game can't reach the network, storage or cookies, and its endless loop is caught", async ({ context, browserName, profile, request }) => {
  const page = await open(context);
  // The run's token is the Player's id: the Game puts it in every URL it tries.
  const token = `tok${Date.now().toString(36)}${browserName}${profile}`;
  const started = await page.evaluate(async (id) => window.harness.create().start(await window.harness.bundle("hostile"), [{ id, name: "Mallory" }], 1), token);
  expect(started).toMatchObject({
    kind: "result",
    outcome: { status: "running" },
  });

  // Each attempt settles within 4 seconds, or says it got no answer.
  const lines = await settled(page, token, ATTEMPTS);
  print(`[${browserName}, ${profile} profile] walls:`, lines);
  for (const name of ATTEMPTS) expect(lines[name], name).not.toMatch(/REACHED/);

  // Proved on the servers: not one request from the worker arrived anywhere.
  expect(await hits(request, SITE, token)).toEqual([]);
  expect(await hits(request, OUTSIDE, token)).toEqual([]);

  // The counting works: the same request from the Screen page itself does arrive.
  await page.evaluate(
    async ([outside, id]) => {
      await fetch(`${outside}/probe/${id}/control`, { mode: "no-cors" });
    },
    [OUTSIDE, token] as const,
  );
  expect(await hits(request, OUTSIDE, token)).toEqual([`GET /probe/${token}/control`]);

  // The endless loop: no reply, so after two seconds the Match is broken and the frame removed.
  const before = Date.now();
  const looped: FrameResult = await page.evaluate((id) => window.harness.frame!.act(id, { type: "loop" }), token);
  const waited = Date.now() - before;
  expect(looped).toEqual({
    kind: "failed",
    problem: "the Game stopped responding",
  });
  expect(waited).toBeGreaterThanOrEqual(1_900);
  expect(waited).toBeLessThan(6_000);
  expect(await page.evaluate(() => window.harness.iframes())).toBe(0);
  console.log(`[${browserName}, ${profile} profile] the loop was caught after ${waited} ms`);

  // The Screen page keeps working: a fresh frame on the same page starts and plays a new Match.
  const players = [
    { id: "ada", name: "Ada" },
    { id: "ben", name: "Ben" },
    { id: "cy", name: "Cy" },
  ];
  const again = await page.evaluate(async (list) => {
    const frame = window.harness.create();
    await frame.start(await window.harness.bundle("best-word"), list, 3);
    return frame.act("ada", { type: "write", text: "still here" });
  }, players);
  expect(again).toMatchObject({
    kind: "result",
    outcome: { status: "running" },
  });
});

test("nothing one Game leaves reaches another: side by side, one after the other, and after a restart", async ({ context, browserName, profile, restart }) => {
  const token = `hoard${Date.now().toString(36)}${browserName}${profile}`;
  const play = async (page: Page, role: "leave" | "find", alongside: boolean) => {
    const id = `${role}-${token}`;
    const started = await page.evaluate(
      async ([playerId, side]) => window.harness.create(side).start(await window.harness.bundle("hoarder"), [{ id: playerId, name: "Hoarder" }], 1),
      [id, alongside] as const,
    );
    expect(started, JSON.stringify(started)).toMatchObject({ kind: "result" });
    return settled(page, id, HOARDS);
  };
  const found: Record<string, Record<string, string>> = {};

  const page = await open(context);
  const left = await play(page, "leave", false);
  // A second Game while the first still runs: a channel or a lock would reach it now or never.
  found["alongside"] = await play(page, "find", true);
  await page.evaluate(() => window.harness.destroyAll());
  found["next"] = await play(page, "find", false);
  // The browser closed and opened again: in a saved profile, whatever was kept on disk is back.
  found["after a restart"] = await play(await open(await restart()), "find", false);

  // The storage manager, in a frame of its own: in Firefox asking it freezes the worker.
  const asked = await open(await restart());
  const askId = `ask-${token}`;
  const answer = await asked.evaluate(async (id) => window.harness.create().start(await window.harness.bundle("hoarder"), [{ id, name: "Hoarder" }], 1), askId);
  const manager =
    answer.kind === "result"
      ? await settledOrFrozen(asked, askId, STORAGE_MANAGER)
      : Object.fromEntries(STORAGE_MANAGER.map((name) => [name, `the Game never answered: ${JSON.stringify(answer)}`]));

  print(`[${browserName}, ${profile} profile] what the first Game tried to leave:`, left);
  print(`[${browserName}, ${profile} profile] what the storage manager said:`, manager);
  for (const name of STORAGE_MANAGER) expect(manager[name], name).not.toMatch(/^ANSWERED/);
  for (const [when, lines] of Object.entries(found)) print(`[${browserName}, ${profile} profile] what a Game ${when} found:`, lines);
  for (const name of HOARDS) expect(left[name], `leave: ${name}`).not.toMatch(/^LEFT/);
  for (const [when, lines] of Object.entries(found)) for (const name of HOARDS) expect(lines[name], `${when}: ${name}`).not.toMatch(/^FOUND/);
});

test("the frame empties the cache store before a Game loads", async ({ context, browserName, profile }) => {
  const page = await open(context);
  await page.evaluate(() => window.harness.create());
  await expect.poll(() => page.frames().some((f) => f.url().startsWith(FRAME))).toBe(true);
  const frame = page.frames().find((f) => f.url().startsWith(FRAME))!;
  await frame.waitForLoadState();

  // Stands in for a Game that got around the removal: a worker of the frame's own, which in
  // WebKit has a working cache store. Elsewhere there is no store to leave anything in.
  const inWorker = (code: string) =>
    frame.evaluate(
      (source) =>
        new Promise<string>((resolve) => {
          const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
          worker.onmessage = (event: MessageEvent<string>) => resolve(event.data);
          worker.onerror = (event) => resolve(`error: ${event.message}`);
        }),
      code,
    );
  const LIST = `(async () => { try { if (typeof caches === "undefined") return postMessage("no store"); postMessage(JSON.stringify(await caches.keys())); } catch (e) { postMessage("no store: " + e); } })();`;
  const planted = await inWorker(
    `(async () => { try { if (typeof caches === "undefined") return postMessage("no store"); const c = await caches.open("leftover"); await c.put(new Request("https://leak.invalid/x"), new Response("x")); postMessage(JSON.stringify(await caches.keys())); } catch (e) { postMessage("no store: " + e); } })();`,
  );
  console.log(`[${browserName}, ${profile} profile] planted before the Game: ${planted}`);
  if (browserName === "webkit") expect(planted).toBe('["leftover"]');

  const started = await page.evaluate(async () =>
    window.harness.frame!.start(
      await window.harness.bundle("best-word"),
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
      ],
      1,
    ),
  );
  expect(started).toMatchObject({
    kind: "result",
    outcome: { status: "running" },
  });
  const after = await inWorker(LIST);
  console.log(`[${browserName}, ${profile} profile] the store once the Game had loaded: ${after}`);
  expect(after).toMatch(/^(\[\]|no store)/);
});

test("a Game that loops forever while loading is caught too", async ({ context }) => {
  const page = await open(context);
  const result = await page.evaluate(() => window.harness.create().start("for (;;) {}", [{ id: "a", name: "A" }], 1));
  expect(result).toEqual({
    kind: "failed",
    problem: "the Game stopped responding",
  });
  expect(await page.evaluate(() => 1 + 1)).toBe(2);
});

test("the frame page carries its walls when opened on its own, and serves nothing else", async ({ request }) => {
  const page = await request.get(`${FRAME}/v1/`);
  expect(page.status()).toBe(200);
  const policy = page.headers()["content-security-policy"] ?? "";
  for (const wall of ["default-src 'none'", "connect-src 'none'", "worker-src blob:", "sandbox allow-scripts", `frame-ancestors ${SITE}`]) expect(policy).toContain(wall);
  expect(policy).not.toContain("allow-same-origin");
  const missing = await request.get(`${FRAME}/api/games`);
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-security-policy"]).toBe(policy);
});

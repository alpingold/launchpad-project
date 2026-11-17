// The Game frame in a real browser: Best Word played through the real frame, served from the game
// domain by the real frame server, driven by the real GameFrame on a page of the site's origin.
import type { Page } from "@playwright/test";
import type { FrameResult } from "../client/src/screen/game-frame.js";
import { availableActions, type AvailableAction } from "../sdk/src/v1/offers.js";
import { expect, test } from "./fixtures.js";
import type { Harness } from "./harness/harness.js";
import { FRAME, SITE } from "./origins.js";

declare global {
  interface Window {
    harness: Harness;
  }
}

const PLAYERS = [
  { id: "ada", name: "Ada" },
  { id: "ben", name: "Ben" },
  { id: "cy", name: "Cy" },
];

async function open(page: Page): Promise<void> {
  await page.goto(`${SITE}/?frame=${encodeURIComponent(`${FRAME}/v1/`)}`);
  await expect(page.locator("body[data-ready=yes]")).toBeAttached();
}

test("plays Best Word to its end through the frame: start, Actions, a Player leaving, the timer, scores", async ({ page }) => {
  await page.clock.install();
  await open(page);
  const four = [...PLAYERS, { id: "dee", name: "Dee" }];

  const started = await page.evaluate(async (players) => {
    const frame = window.harness.create();
    return frame.start(await window.harness.bundle("best-word"), players, 7);
  }, four);
  expect(started).toMatchObject({ kind: "result", outcome: { status: "running", timer: 30_000 } });
  if (started.kind !== "result") return;
  expect(started.views.controllers["ada"]?.parts[0]).toMatchObject({ kind: "textInput", action: { type: "write" } });
  expect(await page.evaluate(() => window.harness.frame?.timerDeadline !== null)).toBe(true);

  // Two write; the others don't.
  const act = (playerId: string, action: unknown) => page.evaluate(([id, a]) => window.harness.frame!.act(id, a), [playerId, action] as const);
  expect(await act("ada", { type: "write", text: "zephyr" })).toMatchObject({ kind: "result", outcome: { status: "running" } });
  expect(await act("ben", { type: "write", text: "quokka" })).toMatchObject({ kind: "result", outcome: { status: "running" } });

  // An Action the View doesn't offer is ignored, and the frame carries on.
  expect(await act("ada", { type: "vote", for: "ben" })).toMatchObject({ kind: "result", outcome: { status: "ignored" } });

  // The writing timer runs out on the Screen's real clock: the GameFrame sends timerFired by itself.
  await page.clock.runFor(30_000);
  await expect.poll(() => page.evaluate(() => window.harness.results.length)).toBe(5);
  const voting = await page.evaluate(() => window.harness.results.at(-1));
  expect(voting).toMatchObject({ kind: "result", outcome: { status: "running", timer: 20_000 } });

  // Dee leaves during voting, leaving 3, Best Word's fewest. The other three vote, and the Match ends with scores.
  expect(await page.evaluate((players) => window.harness.frame!.setPlayers(players), PLAYERS)).toMatchObject({ kind: "result", outcome: { status: "running" } });
  expect(await act("ada", { type: "vote", for: "ben" })).toMatchObject({ kind: "result", outcome: { status: "running" } });
  expect(await act("ben", { type: "vote", for: "ada" })).toMatchObject({ kind: "result", outcome: { status: "running" } });
  const ended = await act("cy", { type: "vote", for: "ada" });
  expect(ended).toMatchObject({ kind: "result", outcome: { status: "ended", reason: "finished", end: { scores: { ada: 2, ben: 1, cy: 0 } } } });

  // Over: the frame is removed (its worker with it), and nothing more is sent.
  expect(await page.evaluate(() => window.harness.iframes())).toBe(0);
  expect(await act("ada", { type: "write", text: "late" })).toEqual({ kind: "failed", problem: "the Match is over" });
});

test("a Match saved mid-way resumes in a fresh frame and plays on", async ({ page }) => {
  await open(page);
  const saved = await page.evaluate(async (players) => {
    const frame = window.harness.create();
    await frame.start(await window.harness.bundle("best-word"), players, 7);
    const result = await frame.act("ada", { type: "write", text: "zephyr" });
    return { result, deadline: frame.timerDeadline };
  }, PLAYERS);
  if (saved.result.kind !== "result") throw new Error("expected a result");
  const snapshot = saved.result.snapshot;

  const resumed = await page.evaluate(
    async ([snap, deadline]) => window.harness.create().resume(await window.harness.bundle("best-word"), snap, deadline),
    [snapshot, saved.deadline] as const,
  );
  expect(resumed).toMatchObject({ kind: "result", outcome: { status: "running" }, views: saved.result.views });
  expect(await page.evaluate(() => window.harness.frame?.timerDeadline)).toBe(saved.deadline);
  expect(await page.evaluate(() => window.harness.frame!.act("ben", { type: "write", text: "quokka" }))).toMatchObject({ kind: "result", outcome: { status: "running" } });
  expect(await page.evaluate(() => window.harness.frame!.act("cy", { type: "write", text: "fjord" }))).toMatchObject({
    kind: "result",
    outcome: { status: "running", timer: 20_000 },
  });
});

test("says why a Match couldn't start, and stays usable for the next try", async ({ page }) => {
  await open(page);
  const tooFew = await page.evaluate(async (players) => window.harness.create().start(await window.harness.bundle("best-word"), players, 1), PLAYERS.slice(0, 2));
  expect(tooFew).toEqual({ kind: "couldNotStart", why: "this Game needs 3 to 8 Players; there are 2" });

  const damaged = await page.evaluate(async () => window.harness.create().resume(await window.harness.bundle("best-word"), { version: 99 } as never, null));
  expect(damaged).toEqual({ kind: "couldNotStart", why: "this isn't a saved Match the Engine can read" });
});

test("a bundle that doesn't load says so, rather than leaving the Screen waiting", async ({ page }) => {
  await open(page);
  const start = (bundle: string) => page.evaluate(([code, players]) => window.harness.create().start(code, players, 1), [bundle, PLAYERS] as const);

  const syntax = await start("this is not { JavaScript");
  expect(syntax).toMatchObject({ kind: "couldNotStart", why: expect.stringMatching(/^the Game's code failed to load: /) });

  const throws = await start('throw new Error("boom");');
  expect(throws).toMatchObject({ kind: "couldNotStart" });
  if (throws.kind === "couldNotStart") expect(throws.why).toMatch(/boom|didn't set BoilerGamesGame/);

  expect(await start("var somethingElse = 1;")).toEqual({ kind: "couldNotStart", why: "the Game's code didn't set BoilerGamesGame to a Game (it is undefined)" });

  // Sloppy code would be allowed to write to an undeclared variable; the frame runs everything strict.
  const sloppy = await start("undeclared = 1; var BoilerGamesGame = {};");
  expect(sloppy).toMatchObject({ kind: "couldNotStart", why: expect.stringMatching(/^the Game's code failed to load: .*undeclared/) });
});

test("trusts nothing from the frame: a made-up reply from the Game's code fails the Match", async ({ page }) => {
  await open(page);
  // At load, before the Engine can answer, the bundle posts a "result" naming a Player the Screen never sent.
  const forged = `postMessage({ type: "result", outcome: { status: "running" }, views: { screen: { parts: [] }, controllers: {} },
    snapshot: { version: 1, status: "running", state: {}, rng: { a: 1, b: 2, c: 3, d: 4 }, players: [{ id: "intruder", name: "Intruder" }], timerRunning: false } });
    var BoilerGamesGame = {};`;
  const result = await page.evaluate(([code, players]) => window.harness.create().start(code, players, 1), [forged, PLAYERS] as const);
  expect(result).toEqual({ kind: "failed", problem: 'the Game frame sent a reply that isn\'t valid: the snapshot has a Player the Screen never sent: "intruder"' });
  expect(await page.evaluate(() => window.harness.iframes())).toBe(0);
});

test("ignores messages that don't come from its own frame", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async (players) => {
    const frame = window.harness.create();
    const pending = frame.start(await window.harness.bundle("best-word"), players, 1);
    // The Screen page itself (or any other window) posting a "reply" changes nothing.
    window.postMessage({ type: "couldNotStart", why: "forged" }, "*");
    return pending;
  }, PLAYERS);
  expect(result).toMatchObject({ kind: "result", outcome: { status: "running" } });
});

/** The Official games, by the id their bundle is named after. */
const OFFICIAL = ["allotments", "scribble-pick", "sum-it-up"];

/** What a Player would send for something their phone offers. */
function fill(offer: AvailableAction): unknown {
  switch (offer.kind) {
    case "exact":
      return offer.action;
    case "text":
      return { ...offer.template, text: "lanterns" };
    case "drawing":
      return { ...offer.template, drawing: { strokes: [{ color: "#ffffff", width: 8, points: [100, 100, 500, 900, 900, 100] }] } };
  }
}

test("the Official games are built and listed in games.json", async ({ request }) => {
  const listing = (await (await request.get(`${SITE}/games/official/games.json`)).json()) as { id: string }[];
  expect(listing.map((game) => game.id)).toEqual(OFFICIAL);
});

for (const id of OFFICIAL) {
  test(`the Official game ${id} plays to its end through the frame, from its built bundle`, async ({ page, request }) => {
    const listing = (await (await request.get(`${SITE}/games/official/games.json`)).json()) as { id: string; players: { min: number } }[];
    const min = listing.find((game) => game.id === id)?.players.min ?? 0;
    const players = Array.from({ length: min }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));
    await page.clock.install();
    await open(page);

    let result: FrameResult = await page.evaluate(
      async ([name, list]) => window.harness.create().start(await window.harness.bundle(name), list, 1),
      [`official/${id}`, players] as const,
    );
    // Each event: the first Player who has something to do does the first thing offered. When
    // nobody has, the Screen's clock runs until the Game's timer runs out.
    for (let events = 0; events < 300; events++) {
      if (result.kind !== "result") throw new Error(`the Match didn't go on: ${JSON.stringify(result)}`);
      if (result.outcome.status === "ended") break;
      const { views } = result;
      const able = players.map((p) => ({ p, offers: availableActions(views.controllers[p.id] ?? { parts: [] }) })).find((c) => c.offers.length > 0);
      if (able !== undefined) {
        const action = fill(able.offers[0]!);
        result = await page.evaluate(([playerId, sent]) => window.harness.frame!.act(playerId, sent), [able.p.id, action] as const);
        continue;
      }
      const before = await page.evaluate(() => window.harness.results.length);
      const wait = await page.evaluate(() => (window.harness.frame!.timerDeadline ?? Date.now()) - Date.now());
      expect(wait, "nobody can act, so the timer must be running").toBeGreaterThan(0);
      await page.clock.runFor(wait);
      await expect.poll(() => page.evaluate(() => window.harness.results.length)).toBeGreaterThan(before);
      result = await page.evaluate(() => window.harness.results.at(-1)!);
    }
    expect(result).toMatchObject({ kind: "result", outcome: { status: "ended", reason: "finished" } });
  });
}

test("the frame page comes from the browser's cache while it is unchanged, and a new build arrives whole, with its own hash", async ({ page, request }) => {
  const frameHits = async () => (await (await request.get(`${SITE}/__frame-hits`)).json()) as string[];
  const startsAMatch = () =>
    page.evaluate(async (players) => (await window.harness.create().start(await window.harness.bundle("best-word"), players, 1)).kind, PLAYERS);
  await open(page);

  // First load, then the same page again: the browser asks with the ETag it has, the server answers
  // 304, and the browser runs its cached copy. The 304 carries the same header, so the hash matches.
  let before = (await frameHits()).length;
  expect(await startsAMatch()).toBe("result");
  expect(await startsAMatch()).toBe("result");
  expect((await frameHits()).slice(before)).toContain("GET /v1/ 304");

  // A new build changes the script. The browser's copy no longer matches: the server sends the new
  // page with 200, and its header allows the new script. Had the old page been paired with the new
  // header, its script would be refused and the frame would never become ready.
  expect((await request.post(`${SITE}/__new-build`)).status()).toBe(200);
  before = (await frameHits()).length;
  expect(await startsAMatch()).toBe("result");
  expect((await frameHits()).slice(before)).toEqual(["GET /v1/ 200"]);
});

test("emptying the storage has its own time, apart from the Game's two seconds, and the Host is told if it runs out", async ({ page }) => {
  await page.clock.install();
  await open(page);
  const start = (mode: string) => page.evaluate((m) => window.harness.createFake(m).start("unused", [{ id: "a", name: "A" }], 1), mode);

  // Emptying takes 3 s: past the Game's two seconds, but the frame's answer is still taken.
  let pending = start("slow");
  await page.clock.runFor(3_100);
  expect(await pending).toEqual({ kind: "couldNotStart", why: "answered after a slow emptying" });

  // The frame says emptying took too long: the Host gets the frame's words.
  pending = start("tooSlow");
  await page.clock.runFor(5_100);
  expect(await pending).toEqual({ kind: "couldNotStart", why: "too slow (the frame's own words)" });

  // Emptied, then the Game says nothing: the usual two seconds.
  pending = start("quiet");
  await page.clock.runFor(2_100);
  expect(await pending).toEqual({ kind: "failed", problem: "the Game stopped responding" });

  // The frame says nothing at all: after its 5 s and the Game's 2 s.
  pending = start("never");
  await page.clock.runFor(6_900);
  await page.clock.runFor(200);
  expect(await pending).toEqual({ kind: "failed", problem: "the Game frame stopped responding while getting ready" });
});

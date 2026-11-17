// The Screen reads every reply out of the Game frame as untrusted: the Game's code shares the worker
// with the Engine and could post anything.
import { describe, expect, test } from "vitest";
import { bestWord } from "./best-word.fixture.js";
import { MAX_REASON_LENGTH, MAX_VIEW_BYTES, readFrameReply, startMatch } from "./engine-entry.js";

const PLAYERS = [
  { id: "ada", name: "Ada" },
  { id: "ben", name: "Ben" },
  { id: "cy", name: "Cy" },
];
const KNOWN = new Set(PLAYERS.map((p) => p.id));

/** A real reply, as the worker would send it after starting Best Word, copied as postMessage would (plain data, so JSON does the same). */
function realReply(): Record<string, unknown> {
  const begun = startMatch(bestWord, { players: PLAYERS, seed: 1 });
  if (!begun.ok) throw new Error(begun.why);
  return JSON.parse(JSON.stringify({ type: "result", outcome: begun.outcome, views: begun.match.views(), snapshot: begun.match.snapshot() })) as Record<string, unknown>;
}

function problem(data: unknown, known: ReadonlySet<string> = KNOWN): string {
  const read = readFrameReply(data, known);
  return read.ok ? "accepted" : read.problem;
}

test("accepts what the Engine really sends", () => {
  const reply = realReply();
  expect(readFrameReply(reply, KNOWN)).toEqual({ ok: true, reply });
  expect(readFrameReply({ type: "couldNotStart", why: "too few" }, KNOWN)).toEqual({ ok: true, reply: { type: "couldNotStart", why: "too few" } });
});

describe("refuses a reply that", () => {
  test("isn't a reply at all", () => {
    expect(problem(null)).toBe("the reply isn't an object");
    expect(problem({ type: "ready" })).toBe('the reply\'s type is "ready"');
    expect(problem({ type: "couldNotStart" })).toBe("couldNotStart has no why");
  });

  test("names a Player the Screen never sent, in the snapshot or the Views", () => {
    expect(problem(realReply(), new Set(["ada", "ben"]))).toBe('the snapshot has a Player the Screen never sent: "cy"');
    const reply = realReply();
    const views = reply["views"] as { controllers: Record<string, unknown> };
    views.controllers["mallory"] = views.controllers["ada"];
    expect(problem(reply)).toBe('the views have a View for "mallory", a Player the Screen never sent');
  });

  test("carries a View the checkers refuse, or one too big to send to a phone", () => {
    const reply = realReply();
    const views = reply["views"] as { screen: unknown; controllers: Record<string, unknown> };
    views.controllers["ada"] = { parts: [{ kind: "script", src: "evil.js" }] };
    expect(problem(reply)).toMatch(/^the views have a View for "ada" that isn't valid: /);

    views.controllers["ada"] = { parts: Array.from({ length: 70 }, () => ({ kind: "text", text: "x".repeat(2_000) })) };
    expect(JSON.stringify(views.controllers["ada"]).length).toBeGreaterThan(MAX_VIEW_BYTES);
    expect(problem(reply)).toBe('the views have a View for "ada" that is too big');

    views.screen = { parts: [{ kind: "button" }] };
    expect(problem(reply)).toMatch(/^the views have a Screen View that isn't valid: /);
  });

  test("has an outcome the Engine could never give", () => {
    const withOutcome = (outcome: unknown) => ({ ...realReply(), outcome });
    expect(problem(withOutcome({ status: "running", timer: -5 }))).toBe("the outcome has a timer that isn't 0 to 24 hours, null or left out");
    expect(problem(withOutcome({ status: "running", timer: Infinity }))).toBe("the outcome has a timer that isn't 0 to 24 hours, null or left out");
    expect(problem(withOutcome({ status: "won" }))).toBe("the outcome has no known status");
    expect(problem(withOutcome({ status: "ended", reason: "finished", end: { scores: { mallory: 9 } } }))).toBe(
      'the outcome has an end that isn\'t valid: scores has "mallory", which isn\'t a Player in the Match',
    );
    expect(problem(withOutcome({ status: "ended", reason: "finished", end: { winners: ["ada", "ada"] } }))).toBe('the outcome has an end that isn\'t valid: winners has "ada" twice');
  });

  test("has a snapshot too big to save, or one that can't be saved at all", () => {
    const reply = realReply();
    const snapshot = reply["snapshot"] as Record<string, unknown>;
    snapshot["state"] = "x".repeat(2 * 1024 * 1024 + 1);
    expect(problem(reply)).toBe("the snapshot is too big to save");
    snapshot["state"] = { n: 10n };
    expect(problem(reply)).toBe("the snapshot can't be saved as JSON");
    snapshot["state"] = {};
    snapshot["timerRunning"] = "yes";
    expect(problem(reply)).toBe("the snapshot has no timerRunning");
  });
});

test("cuts a very long reason instead of keeping all of it", () => {
  const read = readFrameReply({ type: "couldNotStart", why: "x".repeat(MAX_REASON_LENGTH * 3) }, KNOWN);
  expect(read.ok && read.reply.type === "couldNotStart" && read.reply.why.length).toBe(MAX_REASON_LENGTH + 3);
});

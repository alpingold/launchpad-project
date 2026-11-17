// The Engine, from the outside: Matches played through its public functions only.
import { afterEach, describe, expect, test, vi } from "vitest";
import { bestWord } from "./best-word.fixture.js";
import { MAX_STATE_BYTES, MAX_TIMER_MS, resumeMatch, startMatch, type AnyGame, type Match, type Outcome } from "./engine-entry.js";
import { defineGame, type Game, type Player } from "./index.js";

const ada: Player = { id: "a", name: "Ada" };
const ben: Player = { id: "b", name: "Ben" };
const cy: Player = { id: "c", name: "Cy" };
const dee: Player = { id: "d", name: "Dee" };

/** Starts a Match that must start; fails the test with the reason if it doesn't. */
function start(game: AnyGame, players: Player[], seed = 1): { match: Match; outcome: Outcome } {
  const begun = startMatch(game, { players, seed });
  if (!begun.ok) throw new Error(`the Match didn't start: ${begun.why}`);
  return begun;
}

/** The labels of a Player's buttons, to see what their phone shows. */
function buttons(match: Match, id: string): string[] {
  return (match.views().controllers[id]?.parts ?? []).flatMap((p) => (p.kind === "button" ? [p.label] : []));
}

// ---------------------------------------------------------------------------------------------
// A small Game for the rules Best Word doesn't reach: it takes latecomers and uses randomness.
// Everyone taps "Roll"; each roll adds a die to their total; the first to reach `target` wins.

interface DiceState {
  readonly totals: Readonly<Record<string, number>>;
  readonly target: number;
}
type DiceAction = { readonly type: "roll" };

function dice(overrides: Partial<Game<DiceState, DiceAction>> = {}, players = { min: 2, max: 4 }): AnyGame {
  return defineGame<DiceState, DiceAction>({
    about: { title: "Dice", players },
    start: (ctx) => ({ state: { totals: Object.fromEntries(ctx.players.map((p) => [p.id, 0])), target: 12 }, timer: 60_000 }),
    onAction(state, player, _action, ctx) {
      const total = (state.totals[player.id] ?? 0) + ctx.rng.int(1, 6);
      const totals = { ...state.totals, [player.id]: total };
      if (total >= state.target) return { state: { ...state, totals }, end: { scores: totals, winners: [player.id] } };
      return { state: { ...state, totals } };
    },
    onTimer: (state) => ({ state, end: { scores: state.totals } }),
    onLeave(state, player) {
      const totals = { ...state.totals };
      delete totals[player.id];
      return { state: { ...state, totals } };
    },
    onJoin: (state, player) => ({ state: { ...state, totals: { ...state.totals, [player.id]: 0 } } }),
    screen: (state) => ({ parts: [{ kind: "scoreboard", scores: state.totals }, { kind: "timer" }] }),
    controller: (state, player) => ({
      parts: [
        { kind: "text", text: `You have ${state.totals[player.id] ?? 0}` },
        { kind: "button", label: "Roll", action: { type: "roll" } },
      ],
    }),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------------------------

describe("Best Word through the Engine", () => {
  test("plays a whole Match: a Player leaves mid-phase, the timer runs out, the votes end it", () => {
    const { match, outcome } = start(bestWord, [ada, ben, cy, dee]);
    expect(outcome).toEqual({ status: "running", timer: 30_000 });
    expect(match.views().controllers["a"]?.parts).toEqual([{ kind: "textInput", action: { type: "write" }, placeholder: "Your word", maxLength: 20 }]);

    expect(match.act("a", { type: "write", text: "plinth" })).toEqual({ status: "running" });
    expect(match.act("b", { type: "write", text: "gusto" })).toEqual({ status: "running" });
    // Dee leaves while Cy still hasn't written: the Match goes on with three.
    expect(match.setPlayers([ada, ben, cy])).toEqual({ status: "running" });
    expect(Object.keys(match.views().controllers)).toEqual(["a", "b", "c"]);

    // Cy never writes; the writing timer runs out and voting starts with a new timer.
    expect(match.timerFired()).toEqual({ status: "running", timer: 20_000 });
    expect(buttons(match, "c")).toEqual(["plinth", "gusto"]);
    expect(buttons(match, "a")).toEqual(["gusto"]);

    expect(match.act("a", { type: "vote", for: "b" })).toEqual({ status: "running" });
    expect(match.act("b", { type: "vote", for: "a" })).toEqual({ status: "running" });
    expect(match.act("c", { type: "vote", for: "a" })).toEqual({ status: "ended", reason: "finished", end: { scores: { a: 2, b: 1, c: 0 } } });

    expect(match.act("c", { type: "vote", for: "b" })).toEqual({ status: "ignored", why: "the Match is over" });
    expect(match.snapshot().status).toBe("ended");
  });

  test("a Match saved and resumed halfway continues exactly as one that never stopped", () => {
    const events: ((m: Match) => Outcome)[] = [
      (m) => m.act("a", { type: "write", text: "plinth" }),
      (m) => m.act("b", { type: "write", text: "gusto" }),
      (m) => m.setPlayers([ada, ben, cy]),
      (m) => m.timerFired(),
      (m) => m.act("a", { type: "vote", for: "b" }),
      (m) => m.act("b", { type: "vote", for: "a" }),
      (m) => m.act("c", { type: "vote", for: "a" }),
    ];
    expectResumeToMatch(bestWord, [ada, ben, cy, dee], events, 3);
  });
});

/**
 * Plays `events` twice from the same seed: once straight through, and once saved after `saveAfter`
 * events (through JSON, as localStorage would) and resumed. Every Outcome, View and snapshot
 * afterwards must be the same.
 */
function expectResumeToMatch(game: AnyGame, players: Player[], events: ((m: Match) => Outcome)[], saveAfter: number): void {
  const straight = start(game, players, 42).match;
  let resumed = start(game, players, 42).match;
  events.forEach((event, i) => {
    if (i === saveAfter) {
      const saved: unknown = JSON.parse(JSON.stringify(resumed.snapshot()));
      const back = resumeMatch(game, saved);
      if (!back.ok) throw new Error(back.why);
      expect(back.outcome).toEqual({ status: "running" });
      expect(back.match.views()).toEqual(resumed.views());
      resumed = back.match;
    }
    expect(event(resumed)).toEqual(event(straight));
    expect(resumed.views()).toEqual(straight.views());
    expect(resumed.snapshot()).toEqual(straight.snapshot());
  });
}

describe("randomness", () => {
  const rolls = (seed: number) => {
    const { match } = start(dice(), [ada, ben], seed);
    match.act("a", { type: "roll" });
    match.act("a", { type: "roll" });
    return match.snapshot().state;
  };

  test("the same seed gives the same Match; another seed, another", () => {
    expect(rolls(7)).toEqual(rolls(7));
    expect([1, 2, 3, 4, 5].map(rolls).map((s) => JSON.stringify(s))).not.toEqual(Array(5).fill(JSON.stringify(rolls(1))));
  });

  test("a resumed Match draws the same numbers the original would have", () => {
    const roll = (id: string) => (m: Match) => m.act(id, { type: "roll" });
    expectResumeToMatch(dice(), [ada, ben, cy], [roll("a"), roll("b"), roll("c"), roll("a"), roll("b"), roll("c"), roll("a")], 2);
  });

  describe("the Engine reads no clock and no Math.random", () => {
    afterEach(() => vi.restoreAllMocks());
    test("a whole Match plays with both made to throw", () => {
      const forbidden = () => {
        throw new Error("the Engine must not use this");
      };
      vi.spyOn(Math, "random").mockImplementation(forbidden);
      vi.spyOn(Date, "now").mockImplementation(forbidden);
      vi.spyOn(globalThis, "Date").mockImplementation(forbidden as never);
      const { match } = start(dice(), [ada, ben]);
      let outcome = match.act("a", { type: "roll" });
      for (let i = 0; i < 20 && outcome.status === "running"; i++) outcome = match.act(i % 2 ? "a" : "b", { type: "roll" });
      expect(outcome.status).toBe("ended");
    });
  });

  test("ctx.rng works only during the call it was given to", () => {
    let kept: { next(): number } | undefined;
    const game = dice({
      start: (ctx) => {
        kept = ctx.rng;
        return { state: { totals: {}, target: 12 } };
      },
      screen: () => ({ parts: [{ kind: "text", text: String(kept?.next()) }] }),
    });
    const begun = startMatch(game, { players: [ada, ben], seed: 1 });
    expect(begun.ok && begun.outcome).toEqual({ status: "broken", problem: expect.stringMatching(/^screen threw Error: ctx\.rng was used after the function/) });
  });
});

describe("what the Engine ignores", () => {
  test("an Action from someone not in the Match", () => {
    const { match } = start(bestWord, [ada, ben, cy]);
    expect(match.act("z", { type: "write", text: "hi" })).toEqual({ status: "ignored", why: "z isn't a Player in this Match" });
  });

  test("an Action their View doesn't offer", () => {
    const { match } = start(bestWord, [ada, ben, cy]);
    expect(match.act("a", { type: "vote", for: "b" })).toEqual({ status: "ignored", why: "Ada's Controller doesn't offer that action" });
    expect(match.act("a", { type: "write", text: "x".repeat(21) }).status).toBe("ignored");
    expect(match.act("a", "write").status).toBe("ignored");
  });

  test("the timer running out when it isn't running", () => {
    const { match } = start(dice({ start: (ctx) => ({ state: { totals: Object.fromEntries(ctx.players.map((p) => [p.id, 0])), target: 12 } }) }), [ada, ben]);
    expect(match.timerFired()).toEqual({ status: "ignored", why: "the timer isn't running" });
  });

  test("a timer stopped with null doesn't fire", () => {
    const { match } = start(dice({ onAction: (state) => ({ state, timer: null }) }), [ada, ben]);
    expect(match.act("a", { type: "roll" })).toEqual({ status: "running", timer: null });
    expect(match.timerFired().status).toBe("ignored");
  });

  test("the same Players again, or a list that isn't one", () => {
    const { match } = start(dice(), [ada, ben]);
    expect(match.setPlayers([ada, ben])).toEqual({ status: "ignored", why: "nothing changed for the Players in this Match" });
    expect(match.setPlayers([ada, ada]).status).toBe("ignored");
    expect(match.setPlayers("everyone").status).toBe("ignored");
  });
});

describe("setPlayers", () => {
  test("a Player who leaves is removed, then the Game's onLeave is called without them", () => {
    const seen: string[][] = [];
    const { match } = start(dice({ onLeave: (state, player, ctx) => (seen.push([player.id, ...ctx.players.map((p) => p.id)]), { state }) }), [ada, ben, cy]);
    expect(match.setPlayers([ada, cy])).toEqual({ status: "running" });
    expect(seen).toEqual([["b", "a", "c"]]);
    expect(match.snapshot().players).toEqual([ada, cy]);
    expect(match.act("b", { type: "roll" }).status).toBe("ignored");
  });

  test("a Player leaving can move the Match on, and the new timer is reported", () => {
    // Three of four have written; when the fourth leaves, nobody is being waited for, so voting starts.
    const { match } = start(bestWord, [ada, ben, cy, dee]);
    for (const p of [ada, ben, cy]) match.act(p.id, { type: "write", text: p.name });
    expect(match.setPlayers([ada, ben, cy])).toEqual({ status: "running", timer: 20_000 });
    expect(buttons(match, "a")).toEqual(["Ben", "Cy"]);
  });

  test("onLeave may end the Match itself", () => {
    const { match } = start(dice({ onLeave: (state) => ({ state, end: { winners: ["a"] } }) }), [ada, ben, cy]);
    expect(match.setPlayers([ada, ben])).toEqual({ status: "ended", reason: "finished", end: { winners: ["a"] } });
  });

  test("Players leaving below the Game's minimum end the Match", () => {
    const { match } = start(dice(), [ada, ben, cy]);
    expect(match.setPlayers([ada, ben])).toEqual({ status: "running" });
    expect(match.setPlayers([ada])).toEqual({ status: "ended", reason: "tooFewPlayers", end: {} });
    expect(match.act("a", { type: "roll" })).toEqual({ status: "ignored", why: "the Match is over" });
  });

  test("a latecomer joins a Game with onJoin and gets a View", () => {
    const joined: string[] = [];
    const { match } = start(dice({ onJoin: (state, player, ctx) => (joined.push(ctx.players.map((p) => p.id).join()), { state: { ...state, totals: { ...state.totals, [player.id]: 0 } } }) }), [ada, ben]);
    expect(match.setPlayers([ada, ben, cy])).toEqual({ status: "running" });
    expect(joined).toEqual(["a,b,c"]);
    expect(buttons(match, "c")).toEqual(["Roll"]);
  });

  test("a latecomer to a Game without onJoin waits: no View, and their Actions are ignored", () => {
    const { match } = start(dice({ onJoin: undefined }), [ada, ben]);
    expect(match.setPlayers([ada, ben, cy])).toEqual({ status: "ignored", why: "nothing changed for the Players in this Match" });
    expect(match.views().controllers["c"]).toBeUndefined();
    expect(match.act("c", { type: "roll" }).status).toBe("ignored");
  });

  test("a latecomer waits when the Match is full, and joins once someone leaves", () => {
    const { match } = start(dice({}, { min: 2, max: 3 }), [ada, ben, cy]);
    expect(match.setPlayers([ada, ben, cy, dee]).status).toBe("ignored");
    expect(match.views().controllers["d"]).toBeUndefined();
    expect(match.setPlayers([ada, ben, dee])).toEqual({ status: "running" });
    expect(Object.keys(match.views().controllers)).toEqual(["a", "b", "d"]);
  });

  test("a renamed Player is not an event, but the new name is used", () => {
    const { match } = start(bestWord, [ada, ben, cy]);
    expect(match.setPlayers([{ id: "a", name: "Ada (2)" }, ben, cy])).toEqual({ status: "running" });
    expect(match.snapshot().players[0]).toEqual({ id: "a", name: "Ada (2)" });
    expect(match.act("a", { type: "vote", for: "b" })).toEqual({ status: "ignored", why: "Ada (2)'s Controller doesn't offer that action" });
  });
});

describe("starting and resuming", () => {
  test("refuses a Player count the Game doesn't allow, or above 16", () => {
    expect(startMatch(bestWord, { players: [ada, ben], seed: 1 })).toEqual({ ok: false, why: "this Game needs 3 to 8 Players; there are 2" });
    const huge = dice({}, { min: 2, max: 100 });
    const seventeen = Array.from({ length: 17 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    expect(startMatch(huge, { players: seventeen, seed: 1 })).toEqual({ ok: false, why: "a Match holds at most 16 Players" });
  });

  test("refuses a broken Player list or seed", () => {
    expect(startMatch(dice(), { players: [ada, ada], seed: 1 })).toEqual({ ok: false, why: 'two Players have the id "a"' });
    expect(startMatch(dice(), { players: [ada, { id: "", name: "x" }], seed: 1 }).ok).toBe(false);
    expect(startMatch(dice(), { players: [ada, ben], seed: 1.5 }).ok).toBe(false);
  });

  test.each<[string, unknown]>([
    ["not a snapshot", "hello"],
    ["the wrong version", { version: 2 }],
  ])("refuses to resume %s", (_name, snapshot) => {
    expect(resumeMatch(dice(), snapshot).ok).toBe(false);
  });

  test("refuses to resume a damaged or finished snapshot, without throwing", () => {
    const good = start(dice(), [ada, ben]).match.snapshot();
    expect(resumeMatch(dice(), { ...good, rng: { a: 1 } })).toEqual({ ok: false, why: "the saved Match's random-number state is damaged" });
    expect(resumeMatch(dice(), { ...good, players: "x" }).ok).toBe(false);
    expect(resumeMatch(dice(), { ...good, state: { totals: { a: NaN } } }).ok).toBe(false);
    expect(resumeMatch(dice(), { ...good, status: "ended" })).toEqual({ ok: false, why: "this saved Match is already over" });
    expect(resumeMatch(dice(), good).ok).toBe(true);
  });
});

describe("a broken Game", () => {
  /** The Outcome of starting a Dice Match with one function replaced. */
  function startWith(overrides: Partial<Game<DiceState, DiceAction>>): Outcome {
    const begun = startMatch(dice(overrides), { players: [ada, ben], seed: 1 });
    if (!begun.ok) throw new Error(begun.why);
    return begun.outcome;
  }

  /** The Outcome of Ada's first roll, with `onAction` replaced. */
  function rollWith(onAction: (...args: never[]) => unknown): Outcome {
    const { match } = start(dice({ onAction: onAction as never }), [ada, ben]);
    return match.act("a", { type: "roll" });
  }

  const problem = (outcome: Outcome) => (outcome.status === "broken" ? outcome.problem : `not broken: ${JSON.stringify(outcome)}`);

  test("a function that throws", () => {
    expect(problem(rollWith(() => { throw new TypeError("totals is undefined"); }))).toBe("onAction (for Ada) threw TypeError: totals is undefined");
    expect(problem(startWith({ start: () => { throw "oops"; } }))).toBe('start threw "oops"');
  });

  test("a Step that isn't { state, timer?, end? }", () => {
    expect(problem(rollWith(() => undefined))).toBe("onAction (for Ada) must return a Step: { state, timer?, end? }. It returned undefined");
    expect(problem(rollWith(() => ({ totals: {} })))).toBe('onAction (for Ada) returned a Step with an unknown field "totals"; a Step is { state, timer?, end? }');
    expect(problem(rollWith(() => ({ timer: 5 })))).toBe('onAction (for Ada) returned a Step with no "state"; return { state } even when nothing changed');
  });

  test("a timer that isn't milliseconds from 0 to 24 hours, or null", () => {
    expect(problem(rollWith(() => ({ state: {}, timer: -1 })))).toMatch(/^onAction \(for Ada\) returned timer -1; it must be milliseconds from 0 to/);
    expect(problem(rollWith(() => ({ state: {}, timer: MAX_TIMER_MS + 1 })))).toMatch(/^onAction \(for Ada\) returned timer/);
    expect(problem(rollWith(() => ({ state: {}, timer: "30s" })))).toMatch(/returned timer "30s"/);
    expect(problem(rollWith(() => ({ state: {}, timer: Infinity })))).toMatch(/returned timer Infinity/);
  });

  test("a timer started by a Game with no onTimer", () => {
    expect(problem(startWith({ onTimer: undefined }))).toBe("start started the timer, but the Game has no onTimer to call when it runs out");
  });

  test("an end that names someone not in the Match, or isn't scores and winners", () => {
    expect(problem(rollWith(() => ({ state: {}, end: { winners: ["z"] } })))).toBe('onAction (for Ada) returned an end that isn\'t valid: winners has "z", which isn\'t a Player in the Match');
    expect(problem(rollWith(() => ({ state: {}, end: { scores: { a: 1, z: 2 } } })))).toMatch(/scores has "z", which isn't a Player/);
    expect(problem(rollWith(() => ({ state: {}, end: { scores: { a: "1" } } })))).toMatch(/the score for "a" must be a finite number/);
    expect(problem(rollWith(() => ({ state: {}, end: { winner: "a" } })))).toMatch(/an unknown field "winner"/);
  });

  test("state that doesn't survive JSON unchanged", () => {
    expect(problem(rollWith(() => ({ state: { seen: new Set(["a"]) } })))).toBe("onAction (for Ada)'s state must be plain data that JSON keeps whole, but state.seen is a Set, not a plain object");
    expect(problem(rollWith(() => ({ state: { at: new Date(0) } })))).toMatch(/state\.at is a Date/);
    expect(problem(rollWith(() => ({ state: { note: undefined } })))).toMatch(/state\.note is undefined, which JSON leaves out/);
    expect(problem(rollWith(() => ({ state: { n: NaN } })))).toMatch(/state\.n is NaN, which JSON turns into null/);
    expect(problem(rollWith(() => ({ state: { f: () => 1 } })))).toMatch(/state\.f is a function/);
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    expect(problem(rollWith(() => ({ state: cycle })))).toBe("onAction (for Ada)'s state refers to itself (an object inside it contains it), which JSON can't save");
    let deep: unknown = 0;
    for (let i = 0; i < 1_000_000; i++) deep = [deep];
    expect(problem(rollWith(() => ({ state: deep })))).toMatch(/^onAction \(for Ada\)'s state is nested too deeply/);
  });

  test(`state over ${MAX_STATE_BYTES / 1024} KB as JSON`, () => {
    expect(problem(rollWith(() => ({ state: "x".repeat(MAX_STATE_BYTES) })))).toBe("onAction (for Ada)'s state is 257 KB as JSON; the most is 256 KB. Keep less in the state");
    // Counted in UTF-8 bytes: "é" is two of them.
    expect(problem(rollWith(() => ({ state: "é".repeat(MAX_STATE_BYTES / 2) })))).toMatch(/is 257 KB as JSON/);
    // Exactly at the limit is fine: the 2 quote marks bring it to MAX_STATE_BYTES.
    const atLimit = dice({
      onAction: () => ({ state: "x".repeat(MAX_STATE_BYTES - 2) }) as never,
      screen: () => ({ parts: [] }),
      controller: () => ({ parts: [{ kind: "button", label: "Roll", action: { type: "roll" } }] }),
    });
    expect(start(atLimit, [ada, ben]).match.act("a", { type: "roll" })).toEqual({ status: "running" });
  });

  test("a View the site can't show", () => {
    expect(problem(startWith({ screen: () => ({ parts: [{ kind: "button", label: "Go", action: { type: "roll" } }] as never }) }))).toBe(
      "screen returned a View the site can't show: parts[0]: the Screen can't hold a button: it has no inputs. Put it on a Controller",
    );
    expect(problem(startWith({ controller: () => ({ parts: [{ kind: "text" }] as never }) }))).toBe('controller (for Ada) returned a View the site can\'t show: parts[0]: a text needs "text"');
    expect(problem(startWith({ controller: () => { throw new Error("no"); } }))).toBe("controller (for Ada) threw Error: no");
  });

  test("a Game that changes the state it was given, instead of building a new one", () => {
    expect(problem(rollWith(((state: { totals: Record<string, number> }) => { state.totals["a"] = 99; return { state }; }) as never))).toMatch(
      /^onAction \(for Ada\) threw TypeError: .*read.only/i,
    );
  });

  test("onTimer, onLeave and onJoin breaking are named too", () => {
    const thrower = () => {
      throw new Error("bad");
    };
    expect(start(dice({ onTimer: thrower }), [ada, ben]).match.timerFired()).toEqual({ status: "broken", problem: "onTimer threw Error: bad" });
    expect(start(dice({ onLeave: thrower }), [ada, ben, cy]).match.setPlayers([ada, ben])).toEqual({ status: "broken", problem: "onLeave (for Cy) threw Error: bad" });
    expect(start(dice({ onJoin: thrower }), [ada, ben]).match.setPlayers([ada, ben, cy])).toEqual({ status: "broken", problem: "onJoin (for Cy) threw Error: bad" });
  });

  test("once broken, every call is ignored", () => {
    const { match } = start(dice({ onAction: () => { throw new Error("x"); } }), [ada, ben]);
    expect(match.act("a", { type: "roll" }).status).toBe("broken");
    expect(match.act("a", { type: "roll" })).toEqual({ status: "ignored", why: "the Match is over" });
    expect(match.timerFired().status).toBe("ignored");
    expect(match.setPlayers([ada]).status).toBe("ignored");
    expect(match.snapshot().status).toBe("broken");
  });
});

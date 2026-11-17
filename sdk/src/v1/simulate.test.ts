// The simulator: does it pass a good Game, and catch the Games that crash, stick or never end?
import { describe, expect, test } from "vitest";
import { bestWord } from "./best-word.fixture.js";
import { MAX_SIMULATED_EVENTS, simulate } from "./engine-entry.js";
import { defineGame, type Drawing } from "./index.js";

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Best Word, counting how many times a Player leaves. */
function countingLeaves(): { game: typeof bestWord; left: () => number } {
  let left = 0;
  const game: typeof bestWord = {
    ...bestWord,
    onLeave(state, player, ctx) {
      left += 1;
      return bestWord.onLeave(state, player, ctx);
    },
  };
  return { game, left: () => left };
}

describe("Best Word", () => {
  test.each(SEEDS)("plays to its end with its fewest Players (3), seed %i", (seed) => {
    expect(simulate(bestWord, { players: 3, seed })).toMatchObject({ ok: true, problems: [] });
  });

  test.each(SEEDS)("plays to its end with its most Players (8), seed %i", (seed) => {
    expect(simulate(bestWord, { players: 8, seed })).toMatchObject({ ok: true, problems: [] });
  });

  test.each(SEEDS)("plays to its end with its most Players and five leaving, seed %i", (seed) => {
    const { game, left } = countingLeaves();
    expect(simulate(game, { players: 8, seed, leavers: 5 })).toMatchObject({ ok: true, problems: [] });
    expect(left()).toBe(5);
  });

  test("ends properly, by too few Players, when so many leave that fewer than 3 remain", () => {
    for (const seed of SEEDS) {
      const { game, left } = countingLeaves();
      expect(simulate(game, { players: 8, seed, leavers: 7 })).toMatchObject({ ok: true, problems: [] });
      // The sixth to leave takes the Match from 3 Players to 2, below Best Word's 3: it ends there.
      expect(left()).toBe(6);
    }
  });

  test("a Player leaving before anyone has acted is no false alarm, over many seeds", () => {
    // With 3 Players and 1 leaving, the Match often ends by too few Players before others had a turn.
    for (let seed = 1; seed <= 50; seed++) expect(simulate(bestWord, { players: 3, seed, leavers: 1 })).toMatchObject({ ok: true, problems: [] });
  });

  test("the same seed always gives the same run; different seeds, different runs", () => {
    const run = (seed: number) => simulate(bestWord, { players: 8, seed, leavers: 3 });
    for (const seed of SEEDS) expect(run(seed)).toEqual(run(seed));
    expect(new Set(SEEDS.map((seed) => run(seed).steps)).size).toBeGreaterThan(1);
  });
});

test("refuses a Player count the Game doesn't take, saying why", () => {
  expect(simulate(bestWord, { players: 2, seed: 1 })).toEqual({
    ok: false,
    problems: ["the Match couldn't start with 2 Players: this Game needs 3 to 8 Players; there are 2"],
    steps: 0,
  });
  expect(simulate(bestWord, { players: 3, seed: 1, leavers: 3 }).ok).toBe(false);
});

// ---------------------------------------------------------------------------------------------
// Small Games, each wrong in one way.

/** Everyone taps "Done" once. `ends` decides whether the Game then ends the Match. */
function tapOnce(ends: boolean) {
  type State = { readonly done: readonly string[] };
  return defineGame<State, { readonly type: "done" }>({
    about: { title: "Tap once", players: { min: 2, max: 6 } },
    start: () => ({ state: { done: [] } }),
    onAction(state, player, _action, ctx) {
      const done = [...state.done, player.id];
      const all = ctx.players.every((p) => done.includes(p.id));
      return all && ends ? { state: { done }, end: {} } : { state: { done } };
    },
    onLeave: (state) => ({ state }),
    screen: () => ({ parts: [{ kind: "text", text: "Tap!" }] }),
    controller: (state, player) =>
      state.done.includes(player.id) ? { parts: [{ kind: "text", text: "Waiting" }] } : { parts: [{ kind: "button", label: "Done", action: { type: "done" } }] },
  });
}

describe("catches a Game that", () => {
  test("gets stuck: nobody can do anything and no timer is running", () => {
    const result = simulate(tapOnce(false), { players: 3, seed: 1 });
    expect(result).toEqual({
      ok: false,
      problems: ["the Match got stuck after 3 events: no Player has anything to do and no timer is running. Give someone an Action, or start the timer"],
      steps: 3,
    });
  });

  test("never ends", () => {
    const endless = defineGame<{ readonly taps: number }, { readonly type: "tap" }>({
      about: { title: "Endless", players: { min: 1, max: 4 } },
      start: () => ({ state: { taps: 0 } }),
      onAction: (state) => ({ state: { taps: state.taps + 1 } }),
      onLeave: (state) => ({ state }),
      screen: (state) => ({ parts: [{ kind: "text", text: String(state.taps) }] }),
      controller: () => ({ parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] }),
    });
    expect(simulate(endless, { players: 2, seed: 1 })).toEqual({
      ok: false,
      problems: [`the Match didn't end within 5,000 events. Make sure it always ends: after a number of rounds, or when the timer runs out`],
      steps: MAX_SIMULATED_EVENTS,
    });
  });

  test("never ends even though its timer keeps running out", () => {
    const loops = defineGame<{ readonly round: number }, { readonly type: "tap" }>({
      about: { title: "Rounds forever", players: { min: 1, max: 4 } },
      start: () => ({ state: { round: 1 }, timer: 10_000 }),
      onAction: (state) => ({ state }),
      onTimer: (state) => ({ state: { round: state.round + 1 }, timer: 10_000 }),
      onLeave: (state) => ({ state }),
      screen: () => ({ parts: [{ kind: "timer" }] }),
      controller: () => ({ parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] }),
    });
    expect(simulate(loops, { players: 2, seed: 1 }).problems).toEqual([expect.stringMatching(/^the Match didn't end within 5,000 events/)]);
  });

  test("ignores one Player", () => {
    // Only the first Player to join ever gets a button; the Match ends after five taps.
    const lonely = defineGame<{ readonly taps: number }, { readonly type: "tap" }>({
      about: { title: "One Player plays", players: { min: 2, max: 4 } },
      start: () => ({ state: { taps: 0 } }),
      onAction: (state) => (state.taps + 1 >= 5 ? { state: { taps: 5 }, end: {} } : { state: { taps: state.taps + 1 } }),
      onLeave: (state) => ({ state }),
      screen: () => ({ parts: [] }),
      controller: (_state, player, players) => (player.id === players[0]?.id ? { parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] } : { parts: [] }),
    });
    expect(simulate(lonely, { players: 3, seed: 1 })).toEqual({
      ok: false,
      problems: [
        "Player 2 was never offered an Action in the whole Match (5 events). Give every Player something to do",
        "Player 3 was never offered an Action in the whole Match (5 events). Give every Player something to do",
      ],
      steps: 5,
    });
  });

  test("breaks, with the Engine's problem naming the function", () => {
    const crashes = defineGame<{ readonly n: number }, { readonly type: "tap" }>({
      ...tapOnce(true),
      start: () => ({ state: { n: 0 } }),
      onAction: () => {
        throw new TypeError("n is not iterable");
      },
      controller: () => ({ parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] }),
    } as never);
    expect(simulate(crashes, { players: 2, seed: 1 }).problems).toEqual([
      expect.stringMatching(/^the Match broke after 1 event: onAction \(for Player \d\) threw TypeError: n is not iterable$/),
    ]);
  });

  test("is wrong in two ways at once, and reports both", () => {
    // Stuck, and the second Player never had anything to do.
    const both = defineGame<{ readonly tapped: boolean }, { readonly type: "tap" }>({
      about: { title: "Two problems", players: { min: 2, max: 2 } },
      start: () => ({ state: { tapped: false } }),
      onAction: () => ({ state: { tapped: true } }),
      onLeave: (state) => ({ state }),
      screen: () => ({ parts: [] }),
      controller: (state, player) => (!state.tapped && player.id === "p1" ? { parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] } : { parts: [] }),
    });
    expect(simulate(both, { players: 2, seed: 1 }).problems).toEqual([
      expect.stringMatching(/^the Match got stuck after 1 event/),
      expect.stringMatching(/^Player 2 was never offered an Action/),
    ]);
  });
});

test("the simulator's own Actions are always accepted: text boxes, drawing pads, buttons and shapes", () => {
  // Each Player writes a word in a text box of 3 characters at most, draws once, then taps a cell.
  type State = { readonly words: Readonly<Record<string, string>>; readonly drawn: readonly string[]; readonly tapped: readonly string[] };
  type Action = { readonly type: "word"; readonly text: string } | { readonly type: "draw"; readonly drawing: Drawing; readonly round: number } | { readonly type: "cell"; readonly n: number };
  const allDone = (list: readonly string[], ids: readonly { id: string }[]) => ids.every((p) => list.includes(p.id));
  const kitchenSink = defineGame<State, Action>({
    about: { title: "Every input", players: { min: 1, max: 6 } },
    start: () => ({ state: { words: {}, drawn: [], tapped: [] } }),
    onAction(state, player, action, ctx) {
      if (action.type === "word") return { state: { ...state, words: { ...state.words, [player.id]: action.text } } };
      if (action.type === "draw") return { state: { ...state, drawn: [...state.drawn, player.id] } };
      const tapped = [...state.tapped, player.id];
      return allDone(tapped, ctx.players) ? { state: { ...state, tapped }, end: {} } : { state: { ...state, tapped } };
    },
    onLeave: (state) => ({ state }),
    screen: () => ({ parts: [] }),
    controller(state, player) {
      if (!(player.id in state.words)) return { parts: [{ kind: "textInput", action: { type: "word" }, maxLength: 3 }] };
      if (!state.drawn.includes(player.id)) return { parts: [{ kind: "drawingPad", action: { type: "draw", round: 1 } }] };
      if (!state.tapped.includes(player.id)) {
        return { parts: [{ kind: "picture", width: 20, height: 10, shapes: [0, 1].map((n) => ({ shape: "rect" as const, x: n * 10, y: 0, width: 10, height: 10, action: { type: "cell" as const, n } })) }] };
      }
      return { parts: [{ kind: "text", text: "Done" }] };
    },
  });
  for (const seed of SEEDS) expect(simulate(kitchenSink, { players: 6, seed })).toEqual({ ok: true, problems: [], steps: 18 });
});

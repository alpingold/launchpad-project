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

/**
 * Best Word, taking latecomers or not, and recording what happened to each Player: who joined, who
 * left, who acted, and whose Controller was ever drawn. A latecomer simply joins in: during writing
 * they write, during voting they vote.
 */
function watched(takesLatecomers: boolean) {
  const joined: string[] = [];
  const acted = new Set<string>();
  const drawn = new Set<string>();
  let left = 0;
  const game: typeof bestWord = {
    ...bestWord,
    onAction(state, player, action, ctx) {
      acted.add(player.id);
      return bestWord.onAction(state, player, action, ctx);
    },
    onLeave(state, player, ctx) {
      left += 1;
      return bestWord.onLeave(state, player, ctx);
    },
    controller(state, player, players) {
      drawn.add(player.id);
      return bestWord.controller(state, player, players);
    },
    ...(takesLatecomers
      ? {
          onJoin(state: Parameters<typeof bestWord.onLeave>[0], player: { readonly id: string }) {
            joined.push(player.id);
            return { state };
          },
        }
      : {}),
  };
  return { game, joined, acted, drawn, left: () => left };
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

describe("late joiners", () => {
  test("a Game with onJoin takes them in, and each is offered something and has their Actions accepted", () => {
    const actedSomewhere = new Set<string>();
    for (const seed of SEEDS) {
      const { game, joined, acted } = watched(true);
      // 3 start and 5 arrive: Best Word holds 8, so all 5 get in. `ok` means each was offered an
      // Action and none of their Actions was ignored.
      expect(simulate(game, { players: 3, seed, joiners: 5 })).toMatchObject({ ok: true, problems: [] });
      expect([...joined].sort()).toEqual(["p4", "p5", "p6", "p7", "p8"]);
      for (const id of acted) actedSomewhere.add(id);
    }
    // In a single run the clock may run out before a joiner is picked, as for any Player; over the
    // seeds every one of them acts.
    for (const id of ["p4", "p5", "p6", "p7", "p8"]) expect(actedSomewhere.has(id)).toBe(true);
  });

  test.each(SEEDS)("a Game with onJoin that is full lets in only as many as fit; the rest wait, with no problem, seed %i", (seed) => {
    const { game, joined, drawn } = watched(true);
    // 6 start and 4 arrive: only 2 fit under Best Word's 8. The other two never get a View.
    expect(simulate(game, { players: 6, seed, joiners: 4 })).toMatchObject({ ok: true, problems: [] });
    expect(joined).toHaveLength(2);
    const waiting = ["p7", "p8", "p9", "p10"].filter((id) => !joined.includes(id));
    expect(waiting).toHaveLength(2);
    for (const id of waiting) expect(drawn.has(id)).toBe(false);
  });

  test.each(SEEDS)("a Game without onJoin leaves them all waiting, with no problem, seed %i", (seed) => {
    const { game, joined, drawn } = watched(false);
    expect(simulate(game, { players: 3, seed, joiners: 5 })).toMatchObject({ ok: true, problems: [] });
    expect(joined).toEqual([]);
    for (const id of ["p4", "p5", "p6", "p7", "p8"]) expect(drawn.has(id)).toBe(false);
  });

  test("leavers and joiners together: a full Match lets a waiting joiner in when someone leaves", () => {
    let joinedAny = 0;
    for (const seed of SEEDS) {
      const { game, joined, acted, left } = watched(true);
      // 8 start, so the Match is full: a joiner only gets in once a leaver has made room.
      expect(simulate(game, { players: 8, seed, leavers: 3, joiners: 3 })).toMatchObject({ ok: true, problems: [] });
      expect(left()).toBe(3);
      joinedAny += joined.filter((id) => acted.has(id)).length;
    }
    expect(joinedAny).toBeGreaterThan(0);
  });

  test("the same seed always gives the same run with joiners too", () => {
    const run = (seed: number) => simulate(watched(true).game, { players: 4, seed, leavers: 2, joiners: 3 });
    for (const seed of SEEDS) expect(run(seed)).toEqual(run(seed));
  });

  test("refuses more Players in all than a Room holds", () => {
    expect(simulate(bestWord, { players: 8, seed: 1, joiners: 9 })).toEqual({ ok: false, problems: ["joiners must be a whole number from 0 to 16 minus players"], steps: 0 });
    expect(simulate(bestWord, { players: 8, seed: 1, joiners: 8 }).ok).toBe(true);
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

  test("breaks when a latecomer joins, with the problem naming onJoin and the Player", () => {
    const game: typeof bestWord = {
      ...bestWord,
      onJoin() {
        throw new Error("no seat for you");
      },
    };
    expect(simulate(game, { players: 3, seed: 1, joiners: 1 }).problems).toEqual([
      expect.stringMatching(/^the Match broke after \d+ events?: onJoin \(for Player 4\) threw Error: no seat for you$/),
    ]);
  });

  test("takes a latecomer in but leaves them with nothing to do for the rest of the Match", () => {
    // Only the Players who started ever get a button; a newcomer is let in and then forgotten.
    type State = { readonly starters: readonly string[]; readonly done: readonly string[] };
    const forgetful = defineGame<State, { readonly type: "done" }>({
      about: { title: "Forgets newcomers", players: { min: 2, max: 6 } },
      start: (ctx) => ({ state: { starters: ctx.players.map((p) => p.id), done: [] } }),
      onAction(state, player) {
        const done = [...state.done, player.id];
        return state.starters.every((id) => done.includes(id)) ? { state: { ...state, done }, end: {} } : { state: { ...state, done } };
      },
      onJoin: (state) => ({ state }),
      onLeave: (state) => ({ state }),
      screen: () => ({ parts: [] }),
      controller: (state, player) =>
        state.starters.includes(player.id) && !state.done.includes(player.id) ? { parts: [{ kind: "button", label: "Done", action: { type: "done" } }] } : { parts: [{ kind: "text", text: "Wait" }] },
    });
    // 3 start, and 1 arrives within the first 2 events, before the 3 starters have all tapped.
    for (const seed of SEEDS) {
      expect(simulate(forgetful, { players: 3, seed, joiners: 1 })).toEqual({
        ok: false,
        problems: ["Player 4 was never offered an Action in the whole Match (4 events). Give every Player something to do"],
        steps: 4,
      });
    }
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

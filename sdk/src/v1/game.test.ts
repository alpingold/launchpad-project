// Tries the contract on a small Game, the way a Creator would write one, and checks that the
// mistakes it is meant to catch really fail the type check (`npm run typecheck` reads this file).
import { expect, test } from "vitest";
import { checkControllerView, checkLook, checkScreenView } from "./check.js";
import { bestWord, VOTING_MS, WRITING_MS, type Action, type State } from "./best-word.fixture.js";
import { defineGame, type Context, type ControllerView, type Drawing, type Game, type ScreenView, type Player, type Rng } from "./index.js";

const players: Player[] = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Ben" },
  { id: "c", name: "Cy" },
];
const rng: Rng = { next: () => 0, int: (min) => min, pick: (items) => items[0] as never, shuffle: (items) => [...items] };
const ctx: Context = { players, rng };
const [ada, ben, cy] = players as [Player, Player, Player];

test("a Match plays from the first state to its end", () => {
  let step = bestWord.start(ctx);
  expect(step.timer).toBe(WRITING_MS);
  step = bestWord.onAction(step.state, ada, { type: "write", text: "plinth" }, ctx);
  step = bestWord.onAction(step.state, ben, { type: "write", text: "gusto" }, ctx);
  step = bestWord.onAction(step.state, cy, { type: "write", text: "mulch" }, ctx);
  expect(step.state.phase.kind).toBe("voting");

  step = bestWord.onAction(step.state, ada, { type: "vote", for: "b" }, ctx);
  step = bestWord.onAction(step.state, ben, { type: "vote", for: "c" }, ctx);
  step = bestWord.onAction(step.state, cy, { type: "vote", for: "b" }, ctx);
  expect(step.end).toEqual({ scores: { a: 0, b: 2, c: 1 } });
});

test("a Controller's buttons carry the action they send", () => {
  let step = bestWord.start(ctx);
  for (const p of players) step = bestWord.onAction(step.state, p, { type: "write", text: p.name }, ctx);

  expect(bestWord.controller(step.state, ada, players).parts).toEqual([
    { kind: "text", text: "Which word is best?" },
    { kind: "button", label: "Ben", action: { type: "vote", for: "b" } },
    { kind: "button", label: "Cy", action: { type: "vote", for: "c" } },
  ]);
});

test("a Player leaving never leaves the Match waiting", () => {
  let step = bestWord.start(ctx);
  step = bestWord.onAction(step.state, ada, { type: "write", text: "plinth" }, ctx);
  step = bestWord.onAction(step.state, ben, { type: "write", text: "gusto" }, ctx);
  step = bestWord.onLeave(step.state, cy, { players: [ada, ben], rng });
  expect(step.state.phase.kind).toBe("voting");
});

test("every View the Game draws passes the site's checks", () => {
  const views: unknown[] = [board];
  let step = bestWord.start(ctx);
  const look = (s: State): void => {
    expect(checkScreenView(bestWord.screen(s, players))).toEqual({ ok: true, view: bestWord.screen(s, players) });
    for (const p of players) views.push(bestWord.controller(s, p, players));
  };
  look(step.state);
  for (const p of players) {
    step = bestWord.onAction(step.state, p, { type: "write", text: p.name }, ctx);
    look(step.state);
  }
  step = bestWord.onAction(step.state, ada, { type: "vote", for: "b" }, ctx);
  look(step.state);
  for (const view of views) expect(checkControllerView(view)).toMatchObject({ ok: true });
  expect(checkLook(bestWord.about.look)).toMatchObject({ ok: true });

  // A View typed with the Game's own Action is checked as it is: no cast needed.
  const typed: ReturnType<typeof bestWord.controller> = bestWord.controller(step.state, ben, players);
  const result = checkControllerView(typed);
  expect(result.ok).toBe(true);
});

// The Kit's other parts, on a Game that draws and has a board to tap.
type BoardAction =
  | { readonly type: "sketch"; readonly drawing: Drawing }
  | { readonly type: "claim"; readonly cell: number };
const board: ControllerView<BoardAction> = {
  parts: [
    { kind: "drawingPad", action: { type: "sketch" }, colors: ["#000", "#e63946"] },
    {
      kind: "picture",
      width: 300,
      height: 100,
      shapes: [0, 1, 2].map((cell) => ({
        shape: "rect" as const,
        x: cell * 100,
        y: 0,
        width: 100,
        height: 100,
        fill: "surface" as const,
        stroke: "accent" as const,
        action: { type: "claim" as const, cell },
      })),
    },
    { kind: "row", parts: [{ kind: "button", label: "Left", action: { type: "claim", cell: 0 } }, { kind: "timer" }] },
  ],
};

// What the type check must refuse. Each `@ts-expect-error` fails the check if its line compiles.
export function mistakesTheContractCatches(): void {
  type G = typeof bestWord;
  const state: State = { phase: { kind: "voting" }, words: {}, votes: {} };

  // A button that sends an action the Game doesn't have.
  const misspelled: ReturnType<G["controller"]> = {
    // @ts-expect-error "vot" is not one of the Game's actions
    parts: [{ kind: "button", label: "Vote", action: { type: "vot", for: "b" } }],
  };

  // A button that sends half an action.
  const incomplete: ReturnType<G["controller"]> = {
    // @ts-expect-error a "vote" needs its `for`
    parts: [{ kind: "button", label: "Vote", action: { type: "vote" } }],
  };

  // A text box wired to an action with no `text` to fill in.
  const noText: ReturnType<G["controller"]> = {
    // @ts-expect-error "vote" has no `text` field
    parts: [{ kind: "textInput", action: { type: "vote", for: "b" } }],
  };

  // An input on the Screen, which has none.
  const onScreen: ReturnType<G["screen"]> = {
    // @ts-expect-error the Screen can't show a button
    parts: [{ kind: "button", label: "Vote", action: { type: "vote", for: "b" } }],
  };

  // State that JSON would not keep whole.
  const withSet = null as unknown as Game<{ readonly seen: Set<string> }, Action>;
  // @ts-expect-error a Set is not plain data
  defineGame(withSet);
  const withFunction = null as unknown as Game<State, { readonly type: "go"; readonly then: () => void }>;
  // @ts-expect-error neither is a function
  defineGame(withFunction);

  const badPad: ControllerView<BoardAction> = {
    // @ts-expect-error "claim" has no `drawing` field
    parts: [{ kind: "drawingPad", action: { type: "claim", cell: 1 } }],
  };
  const tappableScreen: ScreenView = {
    // @ts-expect-error nothing on the Screen can be tapped
    parts: [{ kind: "picture", width: 10, height: 10, shapes: [{ shape: "circle", x: 5, y: 5, r: 2, action: { type: "claim", cell: 1 } }] }],
  };
  const nestedRows: ScreenView = {
    // @ts-expect-error rows don't nest
    parts: [{ kind: "row", parts: [{ kind: "row", parts: [] }] }],
  };
  const badColor: ScreenView = {
    // @ts-expect-error "red" is neither hex nor one of the look's colours
    parts: [{ kind: "picture", width: 10, height: 10, shapes: [{ shape: "circle", x: 5, y: 5, r: 2, fill: "red" }] }],
  };

  void [badPad, tappableScreen, nestedRows, badColor];
  void [state, misspelled, incomplete, noText, onScreen];
}

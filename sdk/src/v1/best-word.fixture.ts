// Best Word, the small Game the SDK's tests play: written the way a Creator would write one.
// game.test.ts tries the contract on it; the Engine and simulator tests play it through a Match.
// A fixture, not a test file, so it can be imported without running game.test.ts's tests twice.
import { defineGame, type Context, type Player, type Step } from "./index.js";

// Best Word: everyone writes a word, then votes for someone else's. Most votes wins.
export type Phase = { readonly kind: "writing" } | { readonly kind: "voting" };
export interface State {
  readonly phase: Phase;
  readonly words: Readonly<Record<string, string>>;
  readonly votes: Readonly<Record<string, string>>;
}
export type Action = { readonly type: "write"; readonly text: string } | { readonly type: "vote"; readonly for: string };

export const WRITING_MS = 30_000;
export const VOTING_MS = 20_000;

function everyone(done: Readonly<Record<string, unknown>>, players: readonly Player[]): boolean {
  return players.every((p) => p.id in done);
}

function startVoting(state: State): Step<State> {
  return { state: { ...state, phase: { kind: "voting" } }, timer: VOTING_MS };
}

function finish(state: State, players: readonly Player[]): Step<State> {
  const scores: Record<string, number> = {};
  for (const p of players) scores[p.id] = 0;
  for (const votedFor of Object.values(state.votes)) {
    if (votedFor in scores) scores[votedFor] = (scores[votedFor] ?? 0) + 1;
  }
  return { state, end: { scores } };
}

/** Moves on once nobody still in the Match is being waited for. */
function advance(state: State, ctx: Context): Step<State> {
  if (state.phase.kind === "writing" && everyone(state.words, ctx.players)) return startVoting(state);
  if (state.phase.kind === "voting" && everyone(state.votes, ctx.players)) return finish(state, ctx.players);
  return { state };
}

export const bestWord = defineGame<State, Action>({
  about: {
    title: "Best Word",
    players: { min: 3, max: 8 },
    look: { colors: { background: "#14213d", surface: "#22335c", text: "#f5f5f5", accent: "#fca311" }, font: "poster", corners: "round" },
  },

  start: () => ({ state: { phase: { kind: "writing" }, words: {}, votes: {} }, timer: WRITING_MS }),

  onAction(state, player, action, ctx) {
    switch (action.type) {
      case "write":
        if (state.phase.kind !== "writing") return { state };
        return advance({ ...state, words: { ...state.words, [player.id]: action.text } }, ctx);
      case "vote":
        if (state.phase.kind !== "voting" || action.for === player.id) return { state };
        return advance({ ...state, votes: { ...state.votes, [player.id]: action.for } }, ctx);
    }
  },

  onTimer: (state, ctx) => (state.phase.kind === "writing" ? startVoting(state) : finish(state, ctx.players)),

  onLeave: (state, _player, ctx) => advance(state, ctx),

  screen: (state, players) => ({
    parts: [
      { kind: "text", size: "big", text: state.phase.kind === "writing" ? "Write your best word" : "Vote!" },
      { kind: "timer" },
      {
        kind: "playerList",
        players: players.map((p) => ({
          id: p.id,
          mark: p.id in (state.phase.kind === "writing" ? state.words : state.votes) ? ("done" as const) : ("waiting" as const),
        })),
      },
    ],
  }),

  controller(state, player, players) {
    if (state.phase.kind === "writing") {
      if (player.id in state.words) return { parts: [{ kind: "text", text: "Got it. Waiting for the others." }] };
      return { parts: [{ kind: "textInput", action: { type: "write" }, placeholder: "Your word", maxLength: 20 }] };
    }
    if (player.id in state.votes) return { parts: [{ kind: "text", text: "Vote counted." }] };
    return {
      parts: [
        { kind: "text", text: "Which word is best?" },
        ...players
          .filter((p) => p.id !== player.id && p.id in state.words)
          .map((p) => ({
            kind: "button" as const,
            label: state.words[p.id] ?? "",
            action: { type: "vote" as const, for: p.id },
          })),
      ],
    };
  },
});

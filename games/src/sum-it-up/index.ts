/**
 * Sum It Up: a writing and voting game for 3 to 8, grown from the SDK's test Game "Best Word".
 *
 * Three rounds. Each round the Screen shows something everyday ("cold pizza"), and everyone sums it
 * up in one word on their phone. Then everyone votes for the best word that isn't their own. A vote
 * is a point. Between rounds the Screen shows who got the most votes.
 *
 * Late joiners are welcome: whatever the round is doing, they join in at once, writing or voting.
 */
import { defineGame, type ButtonPart, type Context, type ControllerPart, type Player, type Step } from "@boilergames/sdk/v1";

export const ROUNDS = 3;
export const WRITING_MS = 45_000;
export const VOTING_MS = 30_000;
export const RESULTS_MS = 8_000;
/** One word, or a short compound: long enough for "unputdownable", short enough for a button. */
export const MAX_WORD = 24;

/** Everyday things to sum up. Shuffled per Match; each Match uses three. */
export const PROMPTS = [
  "cold pizza",
  "a Monday morning",
  "your first phone",
  "a rainy Sunday",
  "the last day of school",
  "a group chat at 2 a.m.",
  "a fire drill",
  "airport security",
  "a power cut",
  "the dentist",
  "a snow day",
  "an empty fridge",
  "a long car journey",
  "a surprise party",
  "a lost umbrella",
  "a new pair of shoes",
  "a broken escalator",
  "the first day of a holiday",
  "a queue that doesn't move",
  "a cat on a keyboard",
  "a spoiler",
  "a dead phone battery",
  "a family photo",
  "a library",
];

type Phase = { readonly kind: "writing" } | { readonly kind: "voting" } | { readonly kind: "results"; readonly best: readonly string[] };

export interface State {
  /** The three prompts, in order. */
  readonly prompts: readonly string[];
  /** 0, 1 or 2. */
  readonly round: number;
  readonly phase: Phase;
  /** This round's words, by Player id. */
  readonly words: Readonly<Record<string, string>>;
  /** This round's votes: voter id to the id of the Player whose word they chose. */
  readonly votes: Readonly<Record<string, string>>;
  /** Votes received in earlier rounds and this one, by Player id. */
  readonly scores: Readonly<Record<string, number>>;
}

export type Action = { readonly type: "write"; readonly text: string } | { readonly type: "vote"; readonly for: string };

/** The Players `voter` may vote for: everyone still here who wrote a word, except themselves. */
function choices(state: State, voter: string, players: readonly Player[]): Player[] {
  return players.filter((p) => p.id !== voter && p.id in state.words);
}

function startRound(state: State, round: number): Step<State> {
  return { state: { ...state, round, phase: { kind: "writing" }, words: {}, votes: {} }, timer: WRITING_MS };
}

function startVoting(state: State, ctx: Context): Step<State> {
  // With fewer than two words there is nothing to choose between: straight to the results.
  if (Object.keys(state.words).filter((id) => ctx.players.some((p) => p.id === id)).length < 2) return endRound(state, ctx);
  return { state: { ...state, phase: { kind: "voting" } }, timer: VOTING_MS };
}

function endRound(state: State, ctx: Context): Step<State> {
  const scores = { ...state.scores };
  const received: Record<string, number> = {};
  for (const target of Object.values(state.votes)) received[target] = (received[target] ?? 0) + 1;
  for (const [id, count] of Object.entries(received)) scores[id] = (scores[id] ?? 0) + count;
  const top = Math.max(0, ...Object.values(received));
  const best = top === 0 ? [] : Object.keys(received).filter((id) => received[id] === top);
  const next = { ...state, scores };
  if (state.round + 1 >= ROUNDS) return { state: next, end: { scores: present(scores, ctx.players) } };
  return { state: { ...next, phase: { kind: "results", best } }, timer: RESULTS_MS };
}

/** Scores for the Players still here, 0 for anyone who never got a vote. */
function present(scores: Readonly<Record<string, number>>, players: readonly Player[]): Record<string, number> {
  return Object.fromEntries(players.map((p) => [p.id, scores[p.id] ?? 0]));
}

/** Moves on once nobody still here is being waited for. */
function advance(state: State, ctx: Context): Step<State> {
  if (state.phase.kind === "writing" && ctx.players.every((p) => p.id in state.words)) return startVoting(state, ctx);
  if (state.phase.kind === "voting" && ctx.players.every((p) => p.id in state.votes || choices(state, p.id, ctx.players).length === 0)) return endRound(state, ctx);
  return { state };
}

export default defineGame<State, Action>({
  about: {
    title: "Sum It Up",
    players: { min: 3, max: 8 },
    look: { colors: { background: "#fff3b0", text: "#335c67", accent: "#9e2a2b" }, font: "poster", corners: "round" },
  },

  start: (ctx) =>
    startRound({ prompts: ctx.rng.shuffle(PROMPTS).slice(0, ROUNDS), round: 0, phase: { kind: "writing" }, words: {}, votes: {}, scores: {} }, 0),

  onAction(state, player, action, ctx) {
    switch (action.type) {
      case "write": {
        const word = action.text.trim();
        if (state.phase.kind !== "writing" || word === "") return { state };
        return advance({ ...state, words: { ...state.words, [player.id]: word.slice(0, MAX_WORD) } }, ctx);
      }
      case "vote":
        if (state.phase.kind !== "voting" || !choices(state, player.id, ctx.players).some((p) => p.id === action.for)) return { state };
        return advance({ ...state, votes: { ...state.votes, [player.id]: action.for } }, ctx);
    }
  },

  onTimer(state, ctx) {
    switch (state.phase.kind) {
      case "writing":
        return startVoting(state, ctx);
      case "voting":
        return endRound(state, ctx);
      case "results":
        return startRound(state, state.round + 1);
    }
  },

  // Someone who leaves is no longer waited for. Their word stays on the ballot only while they are
  // here (`choices`), and their votes still count.
  onLeave: (state, _player, ctx) => advance(state, ctx),

  // A newcomer joins in at once: `advance` already waits for everyone in ctx.players.
  onJoin: (state) => ({ state }),

  screen(state, players) {
    const prompt = state.prompts[state.round] ?? "";
    const round = { kind: "text" as const, tone: "quiet" as const, text: `Round ${state.round + 1} of ${ROUNDS}` };
    switch (state.phase.kind) {
      case "writing":
      case "voting": {
        const done = state.phase.kind === "writing" ? state.words : state.votes;
        return {
          parts: [
            round,
            { kind: "text", size: "huge", text: prompt },
            { kind: "text", size: "big", tone: "accent", text: state.phase.kind === "writing" ? "Sum it up in one word" : "Vote for the best word" },
            { kind: "timer" },
            { kind: "playerList", players: players.map((p) => ({ id: p.id, mark: p.id in done ? ("done" as const) : ("waiting" as const) })) },
          ],
        };
      }
      case "results": {
        const best = state.phase.best.filter((id) => id in state.words);
        return {
          parts: [
            round,
            { kind: "text", size: "big", text: prompt },
            best.length === 0
              ? { kind: "text", size: "huge", text: "No votes this round" }
              : { kind: "text", size: "huge", tone: "good", text: best.map((id) => `"${state.words[id] ?? ""}"`).join(" and ") },
            {
              kind: "playerList",
              players: players.filter((p) => p.id in state.words).map((p) => ({ id: p.id, note: `"${state.words[p.id] ?? ""}"` })),
            },
            { kind: "scoreboard", title: "Votes so far", scores: present(state.scores, players) },
          ],
        };
      }
    }
  },

  controller(state, player, players) {
    switch (state.phase.kind) {
      case "writing":
        if (player.id in state.words) return { parts: [{ kind: "text", text: `You wrote "${state.words[player.id] ?? ""}". Waiting for the others.` }] };
        return {
          parts: [
            { kind: "text", text: state.prompts[state.round] ?? "", size: "big" },
            { kind: "textInput", action: { type: "write" }, placeholder: "One word", maxLength: MAX_WORD },
          ],
        };
      case "voting": {
        if (player.id in state.votes) return { parts: [{ kind: "text", text: "Vote counted." }] };
        const options = choices(state, player.id, players);
        if (options.length === 0) return { parts: [{ kind: "text", text: "Nothing to vote for this time." }] };
        const buttons: ButtonPart<Action>[] = options.map((p) => ({ kind: "button", label: state.words[p.id] ?? "", action: { type: "vote", for: p.id } }));
        // Two buttons side by side, so eight words still fit a phone without scrolling.
        const rows: ControllerPart<Action>[] = [];
        for (let i = 0; i < buttons.length; i += 2) rows.push({ kind: "row", parts: buttons.slice(i, i + 2) });
        return { parts: [{ kind: "text", text: "Which word sums it up best?" }, ...rows] };
      }
      case "results":
        return { parts: [{ kind: "text", text: "Look at the Screen." }] };
    }
  },
});

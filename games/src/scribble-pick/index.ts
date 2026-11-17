/**
 * Scribble Pick: a drawing game for 3 to 8.
 *
 * Each phone gets its own secret word, and everyone draws theirs at the same time. Then the drawings
 * go up on the Screen one by one, without the artist's name, and everyone else picks what it shows
 * from four words on their phone. A right pick is a point for the picker and a point for the artist,
 * so a clear drawing pays. After each drawing the Screen reveals the word and the artist.
 *
 * The secrets live only on the phones: the Screen never shows a word before its reveal.
 * Latecomers wait for the next Match: they would have no drawing of their own.
 */
import { defineGame, type ButtonPart, type Context, type Drawing, type Hex, type Player, type Step } from "@boilergames/sdk/v1";

export const DRAWING_MS = 75_000;
export const PICKING_MS = 25_000;
export const REVEAL_MS = 6_000;
/** The words a Player sees for each drawing: the right one and this many wrong ones. */
const WRONG_CHOICES = 3;
const PENS: readonly Hex[] = ["#ffffff", "#f4a259", "#ef476f", "#06d6a0", "#118ab2", "#ffd166"];

/** Things anyone can draw in a minute. More than 8 + 8 × 3, so the wrong choices never run out. */
export const WORDS = [
  "bicycle", "cactus", "castle", "crown", "dragon", "guitar", "island", "kite", "ladder", "lighthouse",
  "octopus", "pizza", "rainbow", "rocket", "snail", "snowman", "spider", "teapot", "tent", "tornado",
  "umbrella", "volcano", "whale", "windmill", "anchor", "balloon", "bridge", "candle", "carrot", "clock",
  "dinosaur", "envelope", "feather", "glasses", "hammer", "helicopter", "igloo", "jellyfish", "key", "mushroom",
];

type Phase =
  | { readonly kind: "drawing" }
  /** Everyone but the artist picks from `choices`, the same four words for all, in a shuffled order. */
  | { readonly kind: "picking"; readonly artist: string; readonly choices: readonly string[] }
  | { readonly kind: "reveal"; readonly artist: string };

export interface State {
  readonly phase: Phase;
  /** Each Player's secret word. */
  readonly secrets: Readonly<Record<string, string>>;
  readonly drawings: Readonly<Record<string, Drawing>>;
  /** The artists whose drawings are still to be shown, in order. */
  readonly queue: readonly string[];
  /** For the drawing on show: picker id to the word they picked. */
  readonly picks: Readonly<Record<string, string>>;
  readonly scores: Readonly<Record<string, number>>;
}

export type Action = { readonly type: "draw"; readonly drawing: Drawing } | { readonly type: "pick"; readonly word: string };

/** Scores for the Players still here. */
function present(scores: Readonly<Record<string, number>>, players: readonly Player[]): Record<string, number> {
  return Object.fromEntries(players.map((p) => [p.id, scores[p.id] ?? 0]));
}

/** Shows the next drawing whose artist is still here, or ends the Match when none is left. */
function nextDrawing(state: State, ctx: Context): Step<State> {
  const queue = state.queue.filter((id) => ctx.players.some((p) => p.id === id));
  const artist = queue[0];
  if (artist === undefined) return { state: { ...state, queue }, end: { scores: present(state.scores, ctx.players) } };
  const answer = state.secrets[artist] ?? "";
  const wrong = ctx.rng.shuffle(WORDS.filter((w) => w !== answer)).slice(0, WRONG_CHOICES);
  const choices = ctx.rng.shuffle([answer, ...wrong]);
  return { state: { ...state, queue: queue.slice(1), phase: { kind: "picking", artist, choices }, picks: {} }, timer: PICKING_MS };
}

/** After the drawing phase: the drawings to show, in a shuffled order so nobody can tell whose is whose. */
function startPicking(state: State, ctx: Context): Step<State> {
  const queue = ctx.rng.shuffle(ctx.players.map((p) => p.id).filter((id) => id in state.drawings));
  return nextDrawing({ ...state, queue }, ctx);
}

function reveal(state: State): Step<State> {
  if (state.phase.kind !== "picking") return { state };
  const artist = state.phase.artist;
  const answer = state.secrets[artist];
  const scores = { ...state.scores };
  for (const [picker, word] of Object.entries(state.picks)) {
    if (word !== answer) continue;
    scores[picker] = (scores[picker] ?? 0) + 1;
    scores[artist] = (scores[artist] ?? 0) + 1;
  }
  // The artist may have left while their drawing was on show: it is revealed anyway, still theirs.
  return { state: { ...state, scores, phase: { kind: "reveal", artist } }, timer: REVEAL_MS };
}

/** The Players who pick for the drawing on show: everyone still here but its artist. */
function pickers(state: State, players: readonly Player[]): Player[] {
  const phase = state.phase;
  return phase.kind === "picking" ? players.filter((p) => p.id !== phase.artist) : [];
}

/** Moves on once nobody still here is being waited for. */
function advance(state: State, ctx: Context): Step<State> {
  if (state.phase.kind === "drawing" && ctx.players.every((p) => p.id in state.drawings)) return startPicking(state, ctx);
  if (state.phase.kind === "picking" && pickers(state, ctx.players).every((p) => p.id in state.picks)) return reveal(state);
  return { state };
}

export default defineGame<State, Action>({
  about: {
    title: "Scribble Pick",
    players: { min: 3, max: 8 },
    look: { colors: { background: "#1d1a2f", accent: "#f4a259" }, font: "handwritten", corners: "soft" },
  },

  start(ctx) {
    // Every Player gets a different word.
    const words = ctx.rng.shuffle(WORDS);
    const secrets = Object.fromEntries(ctx.players.map((p, i) => [p.id, words[i] ?? ""]));
    return { state: { phase: { kind: "drawing" }, secrets, drawings: {}, queue: [], picks: {}, scores: {} }, timer: DRAWING_MS };
  },

  onAction(state, player, action, ctx) {
    switch (action.type) {
      case "draw":
        if (state.phase.kind !== "drawing" || player.id in state.drawings) return { state };
        return advance({ ...state, drawings: { ...state.drawings, [player.id]: action.drawing } }, ctx);
      case "pick":
        if (state.phase.kind !== "picking" || player.id === state.phase.artist || player.id in state.picks) return { state };
        return advance({ ...state, picks: { ...state.picks, [player.id]: action.word } }, ctx);
    }
  },

  onTimer(state, ctx) {
    switch (state.phase.kind) {
      case "drawing":
        return startPicking(state, ctx);
      case "picking":
        return reveal(state);
      case "reveal":
        return nextDrawing(state, ctx);
    }
  },

  // If the artist on show leaves, their drawing is still picked and revealed; their queued drawing
  // is skipped (nextDrawing) since nobody would score it for them.
  onLeave: (state, _player, ctx) => advance(state, ctx),

  screen(state, players) {
    const scoreboard = { kind: "scoreboard" as const, title: "Points", scores: present(state.scores, players) };
    switch (state.phase.kind) {
      case "drawing":
        return {
          parts: [
            { kind: "text", size: "huge", text: "Draw your secret word" },
            { kind: "text", tone: "quiet", text: "It's on your phone. Nobody else has the same one." },
            { kind: "timer" },
            { kind: "playerList", players: players.map((p) => ({ id: p.id, mark: p.id in state.drawings ? ("done" as const) : ("waiting" as const) })) },
          ],
        };
      case "picking": {
        const drawing = state.drawings[state.phase.artist];
        return {
          parts: [
            { kind: "text", size: "big", text: "What is it? Pick on your phone." },
            ...(drawing === undefined ? [] : [{ kind: "drawing" as const, drawing }]),
            { kind: "timer" },
            { kind: "playerList", players: pickers(state, players).map((p) => ({ id: p.id, mark: p.id in state.picks ? ("done" as const) : ("waiting" as const) })) },
          ],
        };
      }
      case "reveal": {
        const { artist } = state.phase;
        const answer = state.secrets[artist] ?? "";
        const drawing = state.drawings[artist];
        return {
          parts: [
            { kind: "text", size: "huge", tone: "good", text: `It was "${answer}"` },
            ...(drawing === undefined ? [] : [{ kind: "drawing" as const, drawing, by: artist }]),
            {
              kind: "playerList",
              players: players
                .filter((p) => p.id in state.picks)
                .map((p) => ({ id: p.id, mark: state.picks[p.id] === answer ? ("done" as const) : ("out" as const), note: state.picks[p.id] ?? "" })),
            },
            scoreboard,
          ],
        };
      }
    }
  },

  controller(state, player) {
    switch (state.phase.kind) {
      case "drawing":
        if (player.id in state.drawings) return { parts: [{ kind: "text", text: "Sent. Waiting for the others to finish." }] };
        return {
          parts: [
            { kind: "text", size: "big", tone: "accent", text: `Draw: ${state.secrets[player.id] ?? ""}` },
            { kind: "text", tone: "quiet", text: "No letters or numbers. Keep it secret." },
            { kind: "drawingPad", action: { type: "draw" }, colors: PENS },
          ],
        };
      case "picking": {
        if (player.id === state.phase.artist) return { parts: [{ kind: "text", size: "big", text: "This one is yours. No hints!" }] };
        if (player.id in state.picks) return { parts: [{ kind: "text", text: `You picked "${state.picks[player.id] ?? ""}".` }] };
        const buttons: ButtonPart<Action>[] = state.phase.choices.map((word) => ({ kind: "button", label: word, action: { type: "pick", word } }));
        return {
          parts: [
            { kind: "text", text: "What is the drawing on the Screen?" },
            { kind: "row", parts: buttons.slice(0, 2) },
            { kind: "row", parts: buttons.slice(2) },
          ],
        };
      }
      case "reveal":
        return { parts: [{ kind: "text", text: "Look at the Screen." }] };
    }
  },
});

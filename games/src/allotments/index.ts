/**
 * Allotments: a board game for 2 to 6. The board is a 6 by 6 grid of empty plots, on the Screen and
 * on the phone whose turn it is. On your turn you tap an empty plot to claim it. When every plot is
 * taken, each gardener scores the size of their biggest patch: plots of theirs joined side by side.
 *
 * Late joiners are welcome: they take the next free colour and join the end of the turn order.
 * A turn has a time limit; a gardener who runs out of it gets a plot picked at random. So every turn
 * claims a plot, and a Match always ends after 36 turns.
 */
import { defineGame, type Context, type Hex, type PicturePart, type Player, type Shape, type Step } from "@boilergames/sdk/v1";

const SIDE = 6;
const PLOTS = SIDE * SIDE;
/** How long a turn lasts before a plot is picked for the gardener. */
export const TURN_MS = 20_000;
/** One colour per gardener, told apart by name too, for anyone who can't tell the colours apart. */
const COLOURS: readonly { readonly hex: Hex; readonly name: string }[] = [
  { hex: "#d62828", name: "red" },
  { hex: "#1d4ed8", name: "blue" },
  { hex: "#e9c46a", name: "yellow" },
  { hex: "#7b2cbf", name: "purple" },
  { hex: "#f77f00", name: "orange" },
  { hex: "#111111", name: "black" },
];

export interface State {
  /** Who owns each plot, row by row; null while it is empty. */
  readonly plots: readonly (string | null)[];
  /** The turn order, by Player id: those who started, then joiners in the order they came. */
  readonly order: readonly string[];
  /** Whose turn it is, as a place in `order`. */
  readonly turn: number;
  /** Each gardener's colour, as a place in COLOURS. Kept when someone leaves, so nobody's colour changes. */
  readonly colours: Readonly<Record<string, number>>;
}

export type Action = { readonly type: "claim"; readonly plot: number };

/**
 * A colour for a newcomer: one nobody has had, if there is one. Otherwise one that only gardeners
 * who left had (their plots are drawn faded, so they can't be mistaken for the newcomer's).
 */
function freeColour(state: State): number {
  const everUsed = new Set(Object.values(state.colours));
  const inUse = new Set(state.order.map((id) => state.colours[id]));
  const fresh = COLOURS.findIndex((_, i) => !everUsed.has(i));
  return fresh !== -1 ? fresh : COLOURS.findIndex((_, i) => !inUse.has(i));
}

function active(state: State): string | undefined {
  return state.order[state.turn];
}

/** The biggest patch of each gardener still here: plots joined side by side, not corner to corner. */
export function biggestPatches(plots: readonly (string | null)[], players: readonly Player[]): Record<string, number> {
  const best: Record<string, number> = {};
  for (const p of players) best[p.id] = 0;
  const seen = new Set<number>();
  for (let start = 0; start < PLOTS; start++) {
    const owner = plots[start];
    if (owner === null || owner === undefined || seen.has(start)) continue;
    let size = 0;
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const at = queue.pop()!;
      size += 1;
      const row = Math.floor(at / SIDE);
      const col = at % SIDE;
      const next = [row > 0 ? at - SIDE : -1, row < SIDE - 1 ? at + SIDE : -1, col > 0 ? at - 1 : -1, col < SIDE - 1 ? at + 1 : -1];
      for (const n of next) {
        if (n >= 0 && !seen.has(n) && plots[n] === owner) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    if (owner in best) best[owner] = Math.max(best[owner] ?? 0, size);
  }
  return best;
}

/** Claims `plot` for whoever's turn it is, then passes the turn, or ends the Match when the board is full. */
function claim(state: State, plot: number, ctx: Context): Step<State> {
  const gardener = active(state);
  if (gardener === undefined) return { state };
  const plots = state.plots.map((owner, i) => (i === plot ? gardener : owner));
  if (plots.every((owner) => owner !== null)) return { state: { ...state, plots }, end: { scores: biggestPatches(plots, ctx.players) } };
  return { state: { ...state, plots, turn: (state.turn + 1) % state.order.length }, timer: TURN_MS };
}

export default defineGame<State, Action>({
  about: {
    title: "Allotments",
    players: { min: 2, max: 6 },
    look: { colors: { background: "#e9f5db", surface: "#ffffff", text: "#1b4332", accent: "#2d6a4f" }, font: "rounded", corners: "soft" },
  },

  start(ctx) {
    // The order is shuffled, so whoever joined the Room first doesn't always start.
    const order = ctx.rng.shuffle(ctx.players.map((p) => p.id));
    const colours: Record<string, number> = {};
    order.forEach((id, i) => (colours[id] = i));
    return { state: { plots: Array.from({ length: PLOTS }, () => null), order, turn: 0, colours }, timer: TURN_MS };
  },

  onAction(state, player, action, ctx) {
    // The Engine only lets through what this Player's View offers: an empty plot, on their turn.
    // Checked again anyway, so the rules hold even if the View and the rules ever drift apart.
    if (player.id !== active(state) || state.plots[action.plot] !== null) return { state };
    return claim(state, action.plot, ctx);
  },

  onTimer(state, ctx) {
    const empty = state.plots.flatMap((owner, i) => (owner === null ? [i] : []));
    return claim(state, ctx.rng.pick(empty), ctx);
  },

  onJoin(state, player) {
    const colour = freeColour(state);
    return { state: { ...state, order: [...state.order, player.id], colours: { ...state.colours, [player.id]: colour } } };
  },

  onLeave(state, player) {
    const at = state.order.indexOf(player.id);
    if (at === -1) return { state };
    const order = state.order.filter((id) => id !== player.id);
    // Whoever was after the leaver keeps their place in line: the turn moves back with them.
    const turn = order.length === 0 ? 0 : at < state.turn ? state.turn - 1 : state.turn % order.length;
    // Their plots stay, as overgrown ground nobody scores for. If it was their turn, the next
    // gardener starts a fresh turn.
    return at === state.turn ? { state: { ...state, order, turn }, timer: TURN_MS } : { state: { ...state, order, turn } };
  },

  screen(state, players) {
    const gardener = players.find((p) => p.id === active(state));
    return {
      parts: [
        { kind: "text", size: "big", text: gardener === undefined ? "Allotments" : `${gardener.name} is choosing a plot` },
        { kind: "timer" },
        {
          kind: "row",
          parts: [
            board<never>(state),
            {
              kind: "playerList",
              players: state.order.map((id) => ({
                id,
                mark: id === gardener?.id ? ("active" as const) : ("waiting" as const),
                note: `${COLOURS[state.colours[id] ?? 0]?.name ?? ""}, ${state.plots.filter((owner) => owner === id).length} plots`,
              })),
            },
          ],
        },
        { kind: "scoreboard", title: "Biggest patch so far", scores: biggestPatches(state.plots, players) },
      ],
    };
  },

  controller(state, player, players) {
    const colour = COLOURS[state.colours[player.id] ?? 0]?.name ?? "";
    const mine = player.id === active(state);
    const gardener = players.find((p) => p.id === active(state));
    return {
      parts: [
        mine
          ? { kind: "text", size: "big", tone: "accent", text: "Your turn: tap an empty plot" }
          : { kind: "text", size: "big", text: `${gardener?.name ?? "Someone"} is choosing` },
        { kind: "text", tone: "quiet", text: `Your plots are the ${colour} ones.` },
        board<Action>(state, mine ? (plot) => ({ type: "claim", plot }) : undefined),
      ],
    };
  },
});

/**
 * The board as a picture. With `tap`, for the gardener whose turn it is, each empty plot sends the
 * Action `tap` makes for it. Without, nothing can be tapped: the Screen's picture, and the others'.
 */
function board<A>(state: State, tap?: (plot: number) => A): PicturePart<A> {
  const shapes: Shape<A>[] = state.plots.map((owner, i) => {
    const x = (i % SIDE) * 100 + 5;
    const y = Math.floor(i / SIDE) * 100 + 5;
    const colour = owner === null ? undefined : COLOURS[state.colours[owner] ?? 0]?.hex;
    return {
      shape: "rect",
      x,
      y,
      width: 90,
      height: 90,
      radius: 12,
      fill: colour ?? "surface",
      stroke: "text",
      strokeWidth: 2,
      // A plot whose gardener left looks overgrown: still taken, but faded.
      opacity: owner !== null && !state.order.includes(owner) ? 0.35 : 1,
      ...(owner === null && tap !== undefined ? { action: tap(i) } : {}),
    };
  });
  return { kind: "picture", width: SIDE * 100, height: SIDE * 100, shapes };
}

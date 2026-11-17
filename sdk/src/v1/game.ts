/**
 * SDK v1: the shape of a Game. DRAFT, under design with the owner.
 *
 * A Game is plain functions over plain data. It never touches a clock, the network or the page:
 * the platform owns time (the one timer a Game may set), randomness (`ctx.rng`) and drawing (the
 * views a Game returns). So the same seed and the same events always replay the same Match, which
 * is what lets a Match survive a Screen reload and lets a simulator play a Game to its end.
 */
import type { ControllerView, Look, ScreenView } from "./kit.js";

/** The SDK version a Game written against this folder is recorded with. */
export const SDK_VERSION = 1;

/** Anything `JSON.stringify` keeps whole. A Game's state and its actions are made only of this. */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

/**
 * `T` itself if it is plain data, and a type nothing fits if it isn't (it holds a function, a Map,
 * a Date...). Unlike {@link Json}, this accepts interfaces.
 */
export type PlainData<T> = T extends string | number | boolean | null
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends object
      ? { readonly [K in keyof T]: PlainData<T[K]> }
      : never;

/** A Player as a Game sees them. Key per-Player state by `id`; `name` is only for showing. */
export interface Player {
  readonly id: string;
  readonly name: string;
}

/** What a Game tells the site before a Match starts. */
export interface About {
  readonly title: string;
  /** The fewest and the most Players a Match can hold (the site's own cap is 16). */
  readonly players: { readonly min: number; readonly max: number };
  /** The Game's own colours, typeface and corners. The site's look if left out. */
  readonly look?: Look;
}

/** The only randomness a Game may use, seeded once per Match. */
export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** A whole number from `min` to `max`, both included. */
  int(min: number, max: number): number;
  /** One item of a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** A shuffled copy; the original is left alone. */
  shuffle<T>(items: readonly T[]): T[];
}

/** What every logic function is given besides the state. */
export interface Context {
  /** Everyone in the Match right now, in joining order. The platform keeps this list, not the Game. */
  readonly players: readonly Player[];
  readonly rng: Rng;
}

/** How a Match ended. Both parts are optional: a Game about the moment needs neither. */
export interface MatchEnd {
  /** Final scores by Player id. The site shows them as a scoreboard. */
  readonly scores?: Readonly<Record<string, number>>;
  /** Who won, by Player id. Left out, the top score wins; with no scores either, nobody is named. */
  readonly winners?: readonly string[];
}

/** What every logic function returns: the new state, and optionally a timer change or the end. */
export interface Step<State> {
  /** The new state. Build a new object; never change the old one. */
  readonly state: State;
  /**
   * A Match has one timer. A number (milliseconds) starts it, replacing one already running;
   * `null` stops it; left out, it keeps running. When it runs out, `onTimer` is called.
   */
  readonly timer?: number | null;
  /** Ends the Match. Nothing is called afterwards. */
  readonly end?: MatchEnd;
}

/**
 * A Game. `State` is whatever the Game keeps between events; `Action` is everything a Player can
 * do, as a union of objects told apart by `type`. Controller views carry the exact `Action` each
 * button sends, so a button and the code that handles it can't disagree without a compile error.
 */
export interface Game<State, Action extends { readonly type: string }> {
  readonly about: About;

  /** Builds the first state for the Players in `ctx.players`. */
  start(ctx: Context): Step<State>;

  /** A Player used a part of their Controller that sends `action`. */
  onAction(state: State, player: Player, action: Action, ctx: Context): Step<State>;

  /** The timer ran out. A Game that never sets the timer can leave this out. */
  onTimer?(state: State, ctx: Context): Step<State>;

  /** A Player left for good. `ctx.players` no longer has them. Never wait for someone who left. */
  onLeave(state: State, player: Player, ctx: Context): Step<State>;

  /**
   * A Player joined mid-Match; `ctx.players` already has them. A Game with this function takes
   * late joiners; without it, a latecomer waits in their Seat for the next Match.
   */
  onJoin?(state: State, player: Player, ctx: Context): Step<State>;

  /** What the Screen shows. Everyone can see it, so it must hold no secrets. */
  screen(state: State, players: readonly Player[]): ScreenView;

  /** What one Player's Controller shows. Only that Player's phone ever receives it. */
  controller(state: State, player: Player, players: readonly Player[]): ControllerView<Action>;
}

/** Nothing at all if `T` is plain data; otherwise a requirement no Game meets, named to say why. */
type MustBePlainData<T, What extends string> = [T] extends [PlainData<T>]
  ? unknown
  : { readonly [K in `${What} must be plain data: no functions, Maps, Sets, Dates or classes`]: never };

/**
 * Declares a Game. It returns the Game unchanged; its job is the type check: the state and the
 * actions must be plain data, because both get saved and sent as JSON.
 *
 * @example export default defineGame<State, Action>({ about, start, onAction, onLeave, screen, controller });
 */
export function defineGame<State, Action extends { readonly type: string }>(
  game: Game<State, Action> & MustBePlainData<State, "State"> & MustBePlainData<Action, "Action">,
): Game<State, Action> {
  return game;
}

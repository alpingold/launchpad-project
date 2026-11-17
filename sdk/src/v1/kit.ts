/**
 * SDK v1: the Kit. DRAFT, under design with the owner.
 *
 * A view is plain data: a list of parts, each told apart by `kind`. Games write them as object
 * literals; the site draws them with its own code, so a phone never runs anything a Game wrote.
 *
 * The Kit must not limit Games. Its ready-made parts cover the common cases, and one part,
 * `picture`, is the way out: shapes at any position, any of which a Player can tap.
 */

// ---------------------------------------------------------------------------------------------
// Look

/** A colour as hex: "#1d3557" or "#fa3". */
export type Hex = `#${string}`;

/** A colour from the Game's own look, so a picture follows the theme without repeating it. */
export type LookColor = "background" | "surface" | "text" | "accent";

export type Color = Hex | LookColor;

/**
 * How a Game looks, declared once in `about`. Everything is optional. The site fills the gaps from
 * one of its two default looks, light or dark, whichever suits the Game's `background` (light if it
 * sets none), and always picks black or white for the text on buttons.
 *
 * A look must be readable once its gaps are filled, measured as the WCAG contrast ratio: `text` on
 * `background` and `text` on `surface` at least 4.5 to 1, and `accent` on `background` at least
 * 3 to 1. A look that isn't is refused when the Game is checked, with the colours and the ratios.
 * Setting only a `background` always passes, whatever the colour: the text default is black or
 * white, whichever reads better on it, and where neither default accent shows up on it (a strong red
 * like #e63946, a blue like #3a86ff, mid greys) the accent is that same black or white. A colour the
 * Game does set is never changed, so a Game that sets its own `accent` must make it readable itself.
 */
export interface Look {
  readonly colors?: {
    /** Behind everything. */
    readonly background?: Hex;
    /** Cards, tiles and text boxes. */
    readonly surface?: Hex;
    readonly text?: Hex;
    /** Buttons, the timer and highlights. */
    readonly accent?: Hex;
  };
  /** One of the site's own typefaces. Games can't load fonts: they have no network. */
  readonly font?: "plain" | "rounded" | "serif" | "mono" | "poster" | "handwritten";
  readonly corners?: "sharp" | "soft" | "round";
}

// ---------------------------------------------------------------------------------------------
// Parts that only show something (Screen and Controller)

/** A line or paragraph of text. */
export interface TextPart {
  readonly kind: "text";
  readonly text: string;
  readonly size?: "small" | "normal" | "big" | "huge";
  /** `quiet` for hints, `accent` to stand out, `good` and `bad` for right and wrong. */
  readonly tone?: "quiet" | "accent" | "good" | "bad";
}

/** Counts down the Match's timer. Shows nothing when the timer isn't running. */
export interface TimerPart {
  readonly kind: "timer";
}

/** Scores by Player id. The site adds the names and sorts them, highest first. */
export interface ScoreboardPart {
  readonly kind: "scoreboard";
  readonly scores: Readonly<Record<string, number>>;
  readonly title?: string;
}

/** One tile per Player listed, with their name: who has answered, whose turn it is, who is out. */
export interface PlayerListPart {
  readonly kind: "playerList";
  readonly players: readonly {
    readonly id: string;
    /** `waiting`: we need something from them. `done`: they answered. `active`: their turn. `out`: no longer playing. */
    readonly mark?: "waiting" | "done" | "active" | "out";
    /** A few words under the name: their answer, their role, their score this round. */
    readonly note?: string;
  }[];
}

/**
 * One line of a drawing: flat `[x0, y0, x1, y1, ...]` points in a 1000 by 1000 square, as whole
 * numbers. A Drawing holds at most 200 strokes and 2,000 points in all.
 */
export interface Stroke {
  readonly color: Hex;
  readonly width: number;
  readonly points: readonly number[];
}

/** What a Player drew on a drawing pad. Keep it in the state to show it later. */
export interface Drawing {
  readonly strokes: readonly Stroke[];
}

/** Shows a drawing a Player made. */
export interface DrawingPart {
  readonly kind: "drawing";
  readonly drawing: Drawing;
  /** Whose it is, by Player id; the site shows the name. Leave it out to keep the artist secret. */
  readonly by?: string;
}

// ---------------------------------------------------------------------------------------------
// The picture: free-form shapes

interface ShapeStyle<Action> {
  readonly fill?: Color;
  readonly stroke?: Color;
  readonly strokeWidth?: number;
  /** From 0 (invisible) to 1. */
  readonly opacity?: number;
  /** On a Controller: tapping this shape sends this action. */
  readonly action?: Action;
}

export type Shape<Action> = ShapeStyle<Action> &
  (
    | { readonly shape: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly radius?: number }
    | { readonly shape: "circle"; readonly x: number; readonly y: number; readonly r: number }
    | { readonly shape: "line"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
    /** A closed outline through flat `[x0, y0, x1, y1, ...]` points. */
    | { readonly shape: "polygon"; readonly points: readonly number[] }
    /** An SVG path, for curves: "M 10 80 Q 95 10 180 80". */
    | { readonly shape: "path"; readonly d: string }
    | { readonly shape: "label"; readonly x: number; readonly y: number; readonly text: string; readonly size: number; readonly align?: "start" | "middle" | "end" }
  );

/**
 * A picture `width` by `height` units, scaled to fit, with shapes drawn in the order listed (later
 * ones on top). For boards, maps, dice, cards, charts: whatever the other parts can't show.
 */
export interface PicturePart<Action> {
  readonly kind: "picture";
  readonly width: number;
  readonly height: number;
  readonly shapes: readonly Shape<Action>[];
}

// ---------------------------------------------------------------------------------------------
// Parts a Player uses (Controller only)

/**
 * For a part where the Player supplies a value: the action it sends, minus the field the Player
 * fills in. Only actions that have that field, with that type of value, qualify.
 *
 * The site reads Views without knowing a Game's Action type (`ControllerView<unknown>`). There the
 * action is any plain object: without this first branch it would be `never`, a type no value has.
 * A Game's own Action type never reaches that branch, so it is checked exactly as strictly.
 */
export type Unfilled<Action, Field extends string, Value> = unknown extends Action
  ? Readonly<Record<string, unknown>>
  : Action extends Record<Field, Value>
    ? Omit<Action, Field>
    : never;

/** A button. Tapping it sends `action`, exactly as written here. */
export interface ButtonPart<Action> {
  readonly kind: "button";
  readonly label: string;
  readonly action: Action;
  readonly disabled?: boolean;
}

/** A text box with a send button. Sends `action` with what the Player typed as its `text` field. */
export interface TextInputPart<Action> {
  readonly kind: "textInput";
  readonly action: Unfilled<Action, "text", string>;
  readonly placeholder?: string;
  /** The most characters the Player may type. 80 if left out; 500 at most. */
  readonly maxLength?: number;
}

/** A square to draw on with a finger, and a send button. Sends `action` with the result as its `drawing` field. */
export interface DrawingPadPart<Action> {
  readonly kind: "drawingPad";
  readonly action: Unfilled<Action, "drawing", Drawing>;
  /** The pen colours offered. The site's own set if left out. */
  readonly colors?: readonly Hex[];
}

// ---------------------------------------------------------------------------------------------
// Views

type ShowPart = TextPart | TimerPart | ScoreboardPart | PlayerListPart | DrawingPart;

type ControllerLeaf<Action> = ShowPart | PicturePart<Action> | ButtonPart<Action> | TextInputPart<Action> | DrawingPadPart<Action>;

type ScreenLeaf = ShowPart | PicturePart<never>;

/** Puts parts side by side instead of one under the other. Rows don't nest. */
export interface RowPart<Leaf> {
  readonly kind: "row";
  readonly parts: readonly Leaf[];
}

/** A part a Controller can show. */
export type ControllerPart<Action> = ControllerLeaf<Action> | RowPart<ControllerLeaf<Action>>;

/** A part the Screen can show. The Screen has no inputs: only the Host's own controls. */
export type ScreenPart = ScreenLeaf | RowPart<ScreenLeaf>;

/** What one Controller shows: its parts, top to bottom. */
export interface ControllerView<Action> {
  readonly parts: readonly ControllerPart<Action>[];
}

/** What the Screen shows: its parts, top to bottom. */
export interface ScreenView {
  readonly parts: readonly ScreenPart[];
}

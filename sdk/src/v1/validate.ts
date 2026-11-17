/**
 * Checks a View, a Look or a Drawing that arrives as `unknown`.
 *
 * Why by hand: a View comes from a stranger's Game, so the site can't trust its TypeScript types,
 * and `sdk` has no dependencies (it is bundled into every Game), so there is no Zod here.
 *
 * Every check returns a list of problems instead of stopping at the first one, and each problem
 * says where it is and what to fix, in words a Game author can act on:
 * `parts[2].action: a button needs an action with a "type"`.
 *
 * The checks never throw, whatever they are given: deeply nested data, getters that throw, cycles.
 */
import type {
  ControllerPart,
  ControllerView,
  Drawing,
  Look,
  LookColor,
  PlayerListPart,
  ScreenView,
  Shape,
  Stroke,
  TextPart,
} from "./kit.js";
import { contrastRatio, READABLE_PAIRS, withDefaults } from "./look.js";

// ---------------------------------------------------------------------------------------------
// Limits. Each is named so the docs, the error messages and the tests all use the same number.

/** Parts in one View. A row's own Parts count too, so a row can't be used to get round it. */
export const MAX_PARTS = 100;
/** Characters (UTF-16 units, as a browser's `maxLength` counts them) in any one piece of text. */
export const MAX_TEXT_LENGTH = 2_000;
/** Shapes in one Picture. */
export const MAX_SHAPES = 2_000;
/** The most a text box's `maxLength` may be set to. */
export const MAX_TEXT_INPUT_LENGTH = 500;
/** A text box's `maxLength` when the Game leaves it out. */
export const DEFAULT_TEXT_INPUT_LENGTH = 80;
/** Strokes in one Drawing. */
export const MAX_STROKES = 200;
/** Points in one Drawing, all strokes together. A point is an x and a y: two numbers. */
export const MAX_DRAWING_POINTS = 5_000;
/** The side of the square a Drawing's points live in: 0 to 1000 on both axes. */
export const DRAWING_SIZE = 1_000;
/** Characters in a path's `d`. */
export const MAX_PATH_LENGTH = 2_000;

// These four are not in the build plan. They close gaps it left open, and are listed, with the
// other rules this file adds, in the step's report for the owner to confirm.

/** Points in one polygon. Without it, one polygon could hold millions of numbers. */
export const MAX_POLYGON_POINTS = 1_000;
/**
 * Entries in a scoreboard or a player list. A Room holds 16 Seats at once, but Players leave and
 * latecomers join, so a Game that keeps everyone who ever played on its scoreboard may list more.
 */
export const MAX_LISTED_PLAYERS = 64;
/** Pen colours a drawing pad may offer. */
export const MAX_PEN_COLORS = 16;
/** How deeply an Action may nest objects and arrays. Deeper data is refused, never walked. */
export const MAX_ACTION_DEPTH = 16;

/** After this many problems the rest are counted, not listed: nobody reads problem 51. */
const MAX_PROBLEMS_LISTED = 50;

// ---------------------------------------------------------------------------------------------
// Results

export type CheckResult<Name extends string, Value> =
  | ({ readonly ok: true } & { readonly [K in Name]: Value })
  | { readonly ok: false; readonly problems: string[] };

export function checkControllerView(value: unknown): CheckResult<"view", ControllerView<unknown>> {
  return run(value, (p) => checkView(value, "controller", p), (v) => ({ ok: true, view: v as ControllerView<unknown> }));
}

export function checkScreenView(value: unknown): CheckResult<"view", ScreenView> {
  return run(value, (p) => checkView(value, "screen", p), (v) => ({ ok: true, view: v as ScreenView }));
}

export function checkLook(value: unknown): CheckResult<"look", Look> {
  return run(value, (p) => checkLookAt(value, "look", p), (v) => ({ ok: true, look: v as Look }));
}

/** A Drawing as a drawing pad sends it or a `drawing` Part shows it. Zero strokes is allowed here. */
export function checkDrawing(value: unknown): CheckResult<"drawing", Drawing> {
  return run(value, (p) => checkDrawingAt(value, "drawing", p), (v) => ({ ok: true, drawing: v as Drawing }));
}

/** Runs one check, turning anything thrown (a getter, a Proxy) into a problem instead of a crash. */
function run<R>(value: unknown, check: (p: Problems) => void, ok: (value: unknown) => R): R | { ok: false; problems: string[] } {
  const p = new Problems();
  try {
    check(p);
  } catch {
    p.add("", "it could not be read: reading it threw an error. Use plain objects, arrays, strings and numbers");
  }
  return p.count === 0 ? ok(value) : { ok: false, problems: p.list() };
}

class Problems {
  private readonly listed: string[] = [];
  count = 0;

  add(at: string, message: string): void {
    this.count += 1;
    if (this.listed.length < MAX_PROBLEMS_LISTED) this.listed.push(at === "" ? message : `${at}: ${message}`);
  }

  list(): string[] {
    const more = this.count - this.listed.length;
    return more > 0 ? [...this.listed, `...and ${more} more problems`] : [...this.listed];
  }
}

// ---------------------------------------------------------------------------------------------
// Small checks on single values

type Data = Readonly<Record<string, unknown>>;

/** A plain object: `{...}`, not an array, a Date, a Map or a class instance. */
export function isRecord(value: unknown): value is Data {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A field as TypeScript sees it: an optional field set to `undefined` is the same as left out. */
function has(record: Data, key: string): boolean {
  return Object.hasOwn(record, key) && record[key] !== undefined;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
/**
 * The allowed values of one field, as an object whose keys are exactly the values in kit.ts. Like
 * the field tables below, a value added to or removed from kit.ts and not here fails the type check.
 */
function values<T extends string>(table: Record<T, true>): readonly T[] {
  return Object.keys(table) as T[];
}

const LOOK_COLORS: ReadonlySet<string> = new Set(values<LookColor>({ background: true, surface: true, text: true, accent: true }));
const TEXT_SIZES = values<NonNullable<TextPart["size"]>>({ small: true, normal: true, big: true, huge: true });
const TONES = values<NonNullable<TextPart["tone"]>>({ quiet: true, accent: true, good: true, bad: true });
const MARKS = values<NonNullable<PlayerListPart["players"][number]["mark"]>>({ waiting: true, done: true, active: true, out: true });
const ALIGNS = values<NonNullable<Extract<Shape<unknown>, { readonly shape: "label" }>["align"]>>({ start: true, middle: true, end: true });
const FONTS = values<NonNullable<Look["font"]>>({ plain: true, rounded: true, serif: true, mono: true, poster: true, handwritten: true });
const CORNERS = values<NonNullable<Look["corners"]>>({ sharp: true, soft: true, round: true });

/** Only path commands, digits, spaces and the characters numbers are written with. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9 .,+\-eE]*$/;

function text(v: unknown, at: string, p: Problems): void {
  if (typeof v !== "string") p.add(at, "must be text (a string)");
  else if (v.length > MAX_TEXT_LENGTH) p.add(at, `is ${v.length} characters long; the most is ${MAX_TEXT_LENGTH}`);
}

function id(v: unknown, at: string, p: Problems): void {
  if (typeof v !== "string" || v === "") p.add(at, "must be a Player's id (a non-empty string)");
  else if (v.length > MAX_TEXT_LENGTH) p.add(at, `is ${v.length} characters long; the most is ${MAX_TEXT_LENGTH}`);
}

function num(v: unknown, at: string, p: Problems, range: { min?: number; above?: number; max?: number } = {}): void {
  if (!isFiniteNumber(v)) {
    p.add(at, "must be a finite number");
    return;
  }
  if (range.min !== undefined && v < range.min) p.add(at, `must be at least ${range.min}, not ${v}`);
  if (range.above !== undefined && v <= range.above) p.add(at, `must be more than ${range.above}, not ${v}`);
  if (range.max !== undefined && v > range.max) p.add(at, `must be at most ${range.max}, not ${v}`);
}

function oneOf(v: unknown, at: string, p: Problems, allowed: readonly string[]): void {
  if (typeof v !== "string" || !allowed.includes(v)) p.add(at, `must be one of ${allowed.map((a) => `"${a}"`).join(", ")}`);
}

function hex(v: unknown, at: string, p: Problems): void {
  if (typeof v !== "string" || !HEX.test(v)) p.add(at, 'must be a colour written "#rgb" or "#rrggbb"');
}

function color(v: unknown, at: string, p: Problems): void {
  if (typeof v !== "string" || !(HEX.test(v) || LOOK_COLORS.has(v))) {
    p.add(at, 'must be a colour written "#rgb" or "#rrggbb", or one of the Look\'s "background", "surface", "text", "accent"');
  }
}

/** Calls `each` for every item, after checking it is a list no longer than `max`. */
function list(v: unknown, at: string, p: Problems, max: number, what: string, each: (item: unknown, at: string) => void): void {
  if (!Array.isArray(v)) {
    p.add(at, `must be a list of ${what}`);
    return;
  }
  if (v.length > max) {
    p.add(at, `holds ${v.length} ${what}; the most is ${max}`);
    return;
  }
  for (let i = 0; i < v.length; i++) each(v[i], `${at}[${i}]`);
}

/** A flat `[x0, y0, x1, y1, ...]` list of at least `minPoints` points and at most `maxPoints`. */
function points(v: unknown, at: string, p: Problems, minPoints: number, maxPoints: number, range?: { min: number; max: number }): number {
  if (!Array.isArray(v)) {
    p.add(at, "must be a flat list of numbers: [x0, y0, x1, y1, ...]");
    return 0;
  }
  if (v.length % 2 !== 0) p.add(at, `holds ${v.length} numbers; points come in pairs (x, y), so it needs an even count`);
  const count = Math.floor(v.length / 2);
  if (count < minPoints) p.add(at, `holds ${count} points; it needs at least ${minPoints}`);
  if (count > maxPoints) {
    p.add(at, `holds ${count} points; the most is ${maxPoints}`);
    return count;
  }
  for (let i = 0; i < v.length; i++) num(v[i], `${at}[${i}]`, p, range ?? {});
  return count;
}

// ---------------------------------------------------------------------------------------------
// Fields. Each table lists exactly the fields of one type in kit.ts and whether each is required.
// The tables are typed against kit.ts, so if a field is added, removed or made optional there and
// not here, `npm run typecheck` fails: the checker can't silently drift from the contract.

type Fields<T> = { readonly [K in keyof T]-?: {} extends Pick<T, K> ? "optional" : "required" };

/** Reports missing required fields and unknown ones. Returns false if `v` isn't an object at all. */
function fields(v: unknown, at: string, p: Problems, noun: string, table: Readonly<Record<string, "optional" | "required">>): v is Data {
  if (!isRecord(v)) {
    p.add(at, `${noun} must be an object`);
    return false;
  }
  for (const [key, need] of Object.entries(table)) {
    if (need === "required" && !has(v, key)) p.add(at, `${noun} needs "${key}"`);
  }
  for (const key of Object.keys(v)) {
    if (!Object.hasOwn(table, key)) p.add(at, `${noun} has no field "${key}"`);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Actions

/**
 * An Action inside a View: a plain object with a string `type`, made only of what JSON keeps
 * (it is sent to a phone and back). `noun` and `field` say what it belongs to, for the message.
 */
function action(v: unknown, at: string, p: Problems, noun: string): void {
  if (!isRecord(v) || typeof v["type"] !== "string") {
    p.add(at, `${noun} needs an action with a "type"`);
    return;
  }
  json(v, at, p, 0);
}

/** What JSON keeps whole. An object field set to `undefined` is allowed: JSON leaves it out. */
function json(v: unknown, at: string, p: Problems, depth: number): void {
  if (depth > MAX_ACTION_DEPTH) {
    p.add(at, `an action may nest at most ${MAX_ACTION_DEPTH} levels deep`);
    return;
  }
  if (v === null || typeof v === "string" || typeof v === "boolean") return;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) p.add(at, "must be a finite number: JSON can't carry NaN or Infinity");
    return;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (v[i] === undefined) p.add(`${at}[${i}]`, "must not be undefined: JSON turns it into null");
      else json(v[i], `${at}[${i}]`, p, depth + 1);
    }
    return;
  }
  if (isRecord(v)) {
    for (const key of Object.keys(v)) if (v[key] !== undefined) json(v[key], `${at}.${key}`, p, depth + 1);
    return;
  }
  p.add(at, "must be plain data (text, numbers, true/false, null, lists and plain objects)");
}

/** A text box's or drawing pad's action: an action minus the field the Player fills in. */
function template(v: unknown, at: string, p: Problems, noun: string, filled: "text" | "drawing"): void {
  action(v, at, p, noun);
  if (isRecord(v) && has(v, filled)) p.add(`${at}.${filled}`, `${noun} fills in "${filled}" itself; leave it out of the action`);
}

// ---------------------------------------------------------------------------------------------
// Drawings

const STROKE_FIELDS: Fields<Stroke> = { color: "required", width: "required", points: "required" };
const DRAWING_FIELDS: Fields<Drawing> = { strokes: "required" };

function checkDrawingAt(v: unknown, at: string, p: Problems): void {
  if (!fields(v, at, p, "a drawing", DRAWING_FIELDS) || !has(v, "strokes")) return;
  let total = 0;
  list(v["strokes"], `${at}.strokes`, p, MAX_STROKES, "strokes", (stroke, sat) => {
    if (!fields(stroke, sat, p, "a stroke", STROKE_FIELDS)) return;
    if (has(stroke, "color")) hex(stroke["color"], `${sat}.color`, p);
    if (has(stroke, "width")) num(stroke["width"], `${sat}.width`, p, { above: 0, max: DRAWING_SIZE });
    if (has(stroke, "points")) total += points(stroke["points"], `${sat}.points`, p, 1, MAX_DRAWING_POINTS, { min: 0, max: DRAWING_SIZE });
  });
  if (total > MAX_DRAWING_POINTS) p.add(`${at}.strokes`, `holds ${total} points in all; the most is ${MAX_DRAWING_POINTS}`);
}

// ---------------------------------------------------------------------------------------------
// Look

type LookColors = NonNullable<Look["colors"]>;
const LOOK_FIELDS: Fields<Look> = { colors: "optional", font: "optional", corners: "optional" };
const LOOK_COLOR_FIELDS: Fields<LookColors> = { background: "optional", surface: "optional", text: "optional", accent: "optional" };

function checkLookAt(v: unknown, at: string, p: Problems): void {
  if (!fields(v, at, p, "a look", LOOK_FIELDS)) return;
  const before = p.count;
  if (has(v, "colors") && fields(v["colors"], `${at}.colors`, p, "a look's colours", LOOK_COLOR_FIELDS)) {
    const colors = v["colors"] as Data;
    for (const key of Object.keys(LOOK_COLOR_FIELDS)) if (has(colors, key)) hex(colors[key], `${at}.colors.${key}`, p);
  }
  if (has(v, "font")) oneOf(v["font"], `${at}.font`, p, FONTS);
  if (has(v, "corners")) oneOf(v["corners"], `${at}.corners`, p, CORNERS);
  // Readability can only be measured once every colour is a real colour.
  if (p.count === before) checkReadable(v as Look, at, p);
}

/**
 * Refuses a Look whose text or accent can't be read. The gaps are filled from the site's defaults
 * first: a Look that sets only a dark background would otherwise pass, then be drawn with the
 * default dark text on it. Each problem names both colours, says which came from the defaults,
 * and gives the ratio measured and the one needed, so whoever fixes it (a person or the AI) knows
 * which colour to change and by how much.
 */
function checkReadable(look: Look, at: string, p: Problems): void {
  const full = withDefaults(look).colors;
  for (const { front, back, min } of READABLE_PAIRS) {
    const ratio = contrastRatio(full[front], full[back]);
    if (ratio >= min) continue;
    const name = (key: keyof typeof full): string =>
      look.colors?.[key] === undefined ? `${key} ${full[key]} (the site's default: the look sets no ${key} colour)` : `${key} ${full[key]}`;
    p.add(
      `${at}.colors`,
      `${name(front)} on ${name(back)} has a contrast of ${shown(ratio)} to 1; ${front} on ${back} needs at least ${min} to 1. Make one of them lighter or darker`,
    );
  }
}

/** A ratio to two decimals, rounded down so a failing ratio is never shown as the one needed. */
function shown(ratio: number): string {
  return (Math.floor(ratio * 100) / 100).toFixed(2);
}

// ---------------------------------------------------------------------------------------------
// Shapes

type ShapeName = Shape<unknown>["shape"];
type ShapeOf<S extends ShapeName> = Extract<Shape<unknown>, { readonly shape: S }>;

interface ShapeRule {
  readonly noun: string;
  readonly fields: Readonly<Record<string, "optional" | "required">>;
  readonly check: (shape: Data, at: string, p: Problems) => void;
}

/** The fields every shape has. Typed as a circle minus its own fields, so these can't drift either. */
const STYLE_FIELDS: Fields<Omit<ShapeOf<"circle">, "shape" | "x" | "y" | "r">> = {
  fill: "optional",
  stroke: "optional",
  strokeWidth: "optional",
  opacity: "optional",
  action: "optional",
};

/** One rule per shape in kit.ts. The `Record` type makes a missing shape a type error. */
const SHAPES: { readonly [S in ShapeName]: ShapeRule & { readonly fields: Fields<ShapeOf<S>> } } = {
  rect: {
    noun: "a rect",
    fields: { ...STYLE_FIELDS, shape: "required", x: "required", y: "required", width: "required", height: "required", radius: "optional" },
    check(s, at, p) {
      num(s["x"], `${at}.x`, p);
      num(s["y"], `${at}.y`, p);
      num(s["width"], `${at}.width`, p, { min: 0 });
      num(s["height"], `${at}.height`, p, { min: 0 });
      if (has(s, "radius")) num(s["radius"], `${at}.radius`, p, { min: 0 });
    },
  },
  circle: {
    noun: "a circle",
    fields: { ...STYLE_FIELDS, shape: "required", x: "required", y: "required", r: "required" },
    check(s, at, p) {
      num(s["x"], `${at}.x`, p);
      num(s["y"], `${at}.y`, p);
      num(s["r"], `${at}.r`, p, { min: 0 });
    },
  },
  line: {
    noun: "a line",
    fields: { ...STYLE_FIELDS, shape: "required", x1: "required", y1: "required", x2: "required", y2: "required" },
    check(s, at, p) {
      for (const key of ["x1", "y1", "x2", "y2"]) num(s[key], `${at}.${key}`, p);
    },
  },
  polygon: {
    noun: "a polygon",
    fields: { ...STYLE_FIELDS, shape: "required", points: "required" },
    check(s, at, p) {
      points(s["points"], `${at}.points`, p, 3, MAX_POLYGON_POINTS);
    },
  },
  path: {
    noun: "a path",
    fields: { ...STYLE_FIELDS, shape: "required", d: "required" },
    check(s, at, p) {
      const d = s["d"];
      if (typeof d !== "string") p.add(`${at}.d`, "must be text (a string) such as \"M 10 80 Q 95 10 180 80\"");
      else if (d.length > MAX_PATH_LENGTH) p.add(`${at}.d`, `is ${d.length} characters long; the most is ${MAX_PATH_LENGTH}`);
      else if (!PATH_DATA.test(d)) p.add(`${at}.d`, "may hold only path commands (M L H V C S Q T A Z), numbers, spaces and commas");
    },
  },
  label: {
    noun: "a label",
    fields: { ...STYLE_FIELDS, shape: "required", x: "required", y: "required", text: "required", size: "required", align: "optional" },
    check(s, at, p) {
      num(s["x"], `${at}.x`, p);
      num(s["y"], `${at}.y`, p);
      text(s["text"], `${at}.text`, p);
      num(s["size"], `${at}.size`, p, { above: 0 });
      if (has(s, "align")) oneOf(s["align"], `${at}.align`, p, ALIGNS);
    },
  },
};


function checkShape(v: unknown, at: string, p: Problems, side: Side): void {
  if (!isRecord(v) || typeof v["shape"] !== "string") {
    p.add(at, `a shape needs a "shape": one of ${Object.keys(SHAPES).map((s) => `"${s}"`).join(", ")}`);
    return;
  }
  const rule = Object.hasOwn(SHAPES, v["shape"]) ? SHAPES[v["shape"] as ShapeName] : undefined;
  if (rule === undefined) {
    p.add(`${at}.shape`, `there is no shape "${v["shape"]}"; use one of ${Object.keys(SHAPES).map((s) => `"${s}"`).join(", ")}`);
    return;
  }
  if (!fields(v, at, p, rule.noun, rule.fields)) return;
  for (const key of Object.keys(rule.fields)) if (rule.fields[key] === "required" && !has(v, key)) return;
  rule.check(v, at, p);
  if (has(v, "fill")) color(v["fill"], `${at}.fill`, p);
  if (has(v, "stroke")) color(v["stroke"], `${at}.stroke`, p);
  if (has(v, "strokeWidth")) num(v["strokeWidth"], `${at}.strokeWidth`, p, { min: 0 });
  if (has(v, "opacity")) num(v["opacity"], `${at}.opacity`, p, { min: 0, max: 1 });
  if (has(v, "action")) {
    if (side === "screen") p.add(`${at}.action`, "nothing on the Screen can be tapped; put actions on Controllers");
    else action(v["action"], `${at}.action`, p, `${rule.noun} that can be tapped`);
  }
}

// ---------------------------------------------------------------------------------------------
// Parts

type Side = "controller" | "screen";
type Kind = ControllerPart<unknown>["kind"];
type PartOf<K extends Kind> = Extract<ControllerPart<unknown>, { readonly kind: K }>;

interface PartRule {
  readonly noun: string;
  /** True for Parts a Player uses. The Screen may hold none of them. */
  readonly input: boolean;
  readonly fields: Readonly<Record<string, "optional" | "required">>;
  /** Checks the fields' values. Called only once every required field is there. */
  readonly check: (part: Data, at: string, p: Problems, side: Side) => void;
}

/** One rule per Part in kit.ts. The `Record` type makes a missing Part a type error. */
const PARTS: { readonly [K in Kind]: PartRule & { readonly fields: Fields<PartOf<K>> } } = {
  text: {
    noun: "a text",
    input: false,
    fields: { kind: "required", text: "required", size: "optional", tone: "optional" },
    check(part, at, p) {
      text(part["text"], `${at}.text`, p);
      if (has(part, "size")) oneOf(part["size"], `${at}.size`, p, TEXT_SIZES);
      if (has(part, "tone")) oneOf(part["tone"], `${at}.tone`, p, TONES);
    },
  },
  timer: {
    noun: "a timer",
    input: false,
    fields: { kind: "required" },
    check() {},
  },
  scoreboard: {
    noun: "a scoreboard",
    input: false,
    fields: { kind: "required", scores: "required", title: "optional" },
    check(part, at, p) {
      const scores = part["scores"];
      if (!isRecord(scores)) p.add(`${at}.scores`, "must be an object of scores by Player id: { [id]: number }");
      else {
        const ids = Object.keys(scores);
        if (ids.length > MAX_LISTED_PLAYERS) p.add(`${at}.scores`, `holds ${ids.length} scores; the most is ${MAX_LISTED_PLAYERS}`);
        else for (const key of ids) num(scores[key], `${at}.scores.${key}`, p);
      }
      if (has(part, "title")) text(part["title"], `${at}.title`, p);
    },
  },
  playerList: {
    noun: "a player list",
    input: false,
    fields: { kind: "required", players: "required" },
    check(part, at, p) {
      const entry: Fields<PlayerListPart["players"][number]> = { id: "required", mark: "optional", note: "optional" };
      list(part["players"], `${at}.players`, p, MAX_LISTED_PLAYERS, "players", (item, iat) => {
        if (!fields(item, iat, p, "a player list entry", entry)) return;
        id(item["id"], `${iat}.id`, p);
        if (has(item, "mark")) oneOf(item["mark"], `${iat}.mark`, p, MARKS);
        if (has(item, "note")) text(item["note"], `${iat}.note`, p);
      });
    },
  },
  drawing: {
    noun: "a drawing",
    input: false,
    fields: { kind: "required", drawing: "required", by: "optional" },
    check(part, at, p) {
      checkDrawingAt(part["drawing"], `${at}.drawing`, p);
      if (has(part, "by")) id(part["by"], `${at}.by`, p);
    },
  },
  picture: {
    noun: "a picture",
    input: false,
    fields: { kind: "required", width: "required", height: "required", shapes: "required" },
    check(part, at, p, side) {
      num(part["width"], `${at}.width`, p, { above: 0 });
      num(part["height"], `${at}.height`, p, { above: 0 });
      list(part["shapes"], `${at}.shapes`, p, MAX_SHAPES, "shapes", (shape, sat) => checkShape(shape, sat, p, side));
    },
  },
  button: {
    noun: "a button",
    input: true,
    fields: { kind: "required", label: "required", action: "required", disabled: "optional" },
    check(part, at, p) {
      text(part["label"], `${at}.label`, p);
      action(part["action"], `${at}.action`, p, "a button");
      if (has(part, "disabled") && typeof part["disabled"] !== "boolean") p.add(`${at}.disabled`, "must be true or false");
    },
  },
  textInput: {
    noun: "a text box",
    input: true,
    fields: { kind: "required", action: "required", placeholder: "optional", maxLength: "optional" },
    check(part, at, p) {
      template(part["action"], `${at}.action`, p, "a text box", "text");
      if (has(part, "placeholder")) text(part["placeholder"], `${at}.placeholder`, p);
      if (has(part, "maxLength")) {
        const max = part["maxLength"];
        if (!Number.isInteger(max)) p.add(`${at}.maxLength`, "must be a whole number");
        else num(max, `${at}.maxLength`, p, { min: 1, max: MAX_TEXT_INPUT_LENGTH });
      }
    },
  },
  drawingPad: {
    noun: "a drawing pad",
    input: true,
    fields: { kind: "required", action: "required", colors: "optional" },
    check(part, at, p) {
      template(part["action"], `${at}.action`, p, "a drawing pad", "drawing");
      if (has(part, "colors")) {
        const colors = part["colors"];
        if (Array.isArray(colors) && colors.length === 0) p.add(`${at}.colors`, "needs at least one colour, or leave it out for the site's own set");
        list(colors, `${at}.colors`, p, MAX_PEN_COLORS, "colours", (c, cat) => hex(c, cat, p));
      }
    },
  },
  row: {
    noun: "a row",
    input: false,
    fields: { kind: "required", parts: "required" },
    // A row's Parts are checked by `checkParts`, and counted toward MAX_PARTS by `checkView`.
    check() {},
  },
};

const KINDS = Object.keys(PARTS).map((k) => `"${k}"`).join(", ");

function checkView(v: unknown, side: Side, p: Problems): void {
  if (!isRecord(v) || !Array.isArray(v["parts"])) {
    p.add("", 'a view must be an object with a list of "parts": { parts: [...] }');
    return;
  }
  for (const key of Object.keys(v)) if (key !== "parts") p.add(key, 'a view has no field "' + key + '"; only "parts"');
  // Count first, rows' Parts included, so a View far over the limit is refused without walking it.
  const parts: readonly unknown[] = v["parts"];
  let count = parts.length;
  for (const part of parts) if (isRecord(part) && part["kind"] === "row" && Array.isArray(part["parts"])) count += part["parts"].length;
  if (count > MAX_PARTS) {
    p.add("parts", `the view holds ${count} parts (a row's parts count too); the most is ${MAX_PARTS}`);
    return;
  }
  checkParts(parts, "parts", side, p);
}

function checkParts(parts: readonly unknown[], at: string, side: Side, p: Problems): void {
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const pat = `${at}[${i}]`;
    if (!isRecord(part) || typeof part["kind"] !== "string") {
      p.add(pat, `a part needs a "kind": one of ${KINDS}`);
      continue;
    }
    const kind = part["kind"];
    const rule = Object.hasOwn(PARTS, kind) ? PARTS[kind as Kind] : undefined;
    if (rule === undefined) {
      p.add(`${pat}.kind`, `there is no part "${kind}"; use one of ${KINDS}`);
      continue;
    }
    if (side === "screen" && rule.input) {
      p.add(pat, `the Screen can't hold ${rule.noun}: it has no inputs. Put it on a Controller`);
      continue;
    }
    if (!fields(part, pat, p, rule.noun, rule.fields)) continue;
    if (Object.keys(rule.fields).some((key) => rule.fields[key] === "required" && !has(part, key))) continue;
    if (kind === "row") {
      const inner = part["parts"];
      if (!Array.isArray(inner)) p.add(`${pat}.parts`, "must be a list of parts");
      else {
        const nested = inner.findIndex((x) => isRecord(x) && x["kind"] === "row");
        if (nested !== -1) p.add(`${pat}.parts[${nested}]`, "rows don't nest: a row can't hold another row");
        else checkParts(inner, `${pat}.parts`, side, p);
      }
      continue;
    }
    rule.check(part, pat, p, side);
  }
}

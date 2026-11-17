/**
 * Does a Controller's View offer this Action?
 *
 * An Action arrives from a phone, and a phone can send anything. The Engine accepts an Action only
 * if the Player's current View offers it: an enabled button or a tappable shape carrying exactly
 * that Action, or a text box or drawing pad whose Action it is once the Player's text or drawing is
 * filled in. So a Game only ever sees Actions it put on that Player's screen itself.
 *
 * `view` must already have passed `checkControllerView`. `action` may be anything at all; these
 * functions never throw on it.
 */
import type { ControllerPart, ControllerView } from "./kit.js";
import { checkDrawing, DEFAULT_TEXT_INPUT_LENGTH, isRecord, MAX_ACTION_DEPTH } from "./validate.js";

/** An Action a View offers, as the simulator (and later the Playtest) needs it. */
export type AvailableAction =
  /** Send `action` exactly as it is: a button or a tappable shape. */
  | { readonly kind: "exact"; readonly action: unknown }
  /** Add a non-blank `text` of at most `maxLength` characters to `template`, then send it. */
  | { readonly kind: "text"; readonly template: Readonly<Record<string, unknown>>; readonly maxLength: number }
  /** Add a `drawing` of at least one stroke to `template`, then send it. */
  | { readonly kind: "drawing"; readonly template: Readonly<Record<string, unknown>> };

export function offers(view: ControllerView<unknown>, action: unknown): boolean {
  try {
    return availableActions(view).some((offer) => matches(offer, action));
  } catch {
    // Only data that isn't plain JSON (a getter, a Proxy) can get here. Whatever it is, it isn't offered.
    return false;
  }
}

/** Every Action the View offers, in the order its Parts are drawn. Disabled buttons are left out. */
export function availableActions(view: ControllerView<unknown>): AvailableAction[] {
  const found: AvailableAction[] = [];
  const visit = (part: ControllerPart<unknown>): void => {
    switch (part.kind) {
      case "row":
        part.parts.forEach(visit);
        break;
      case "button":
        if (part.disabled !== true) found.push({ kind: "exact", action: part.action });
        break;
      case "picture":
        for (const shape of part.shapes) if (shape.action !== undefined) found.push({ kind: "exact", action: shape.action });
        break;
      case "textInput":
        found.push({ kind: "text", template: part.action, maxLength: part.maxLength ?? DEFAULT_TEXT_INPUT_LENGTH });
        break;
      case "drawingPad":
        found.push({ kind: "drawing", template: part.action });
        break;
    }
  };
  view.parts.forEach(visit);
  return found;
}

function matches(offer: AvailableAction, action: unknown): boolean {
  switch (offer.kind) {
    case "exact":
      return sameJson(offer.action, action);
    case "text": {
      if (!isRecord(action)) return false;
      const text = action["text"];
      if (typeof text !== "string" || text.trim() === "" || text.length > offer.maxLength) return false;
      return sameJson(offer.template, without(action, "text"));
    }
    case "drawing": {
      if (!isRecord(action)) return false;
      const drawing = checkDrawing(action["drawing"]);
      if (!drawing.ok || drawing.drawing.strokes.length === 0) return false;
      return sameJson(offer.template, without(action, "drawing"));
    }
  }
}

function without(record: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const k of Object.keys(record)) if (k !== key) copy[k] = record[k];
  return copy;
}

/**
 * Equal as JSON would see them: key order doesn't matter, and an object field set to `undefined`
 * is the same as one left out (the phone's copy went through JSON and lost it). `expected` comes
 * from a checked View, so its depth is bounded; `actual` may be anything, and the walk never goes
 * deeper than `expected` does, so a deeply nested Action from a phone can't overflow the stack.
 */
function sameJson(expected: unknown, actual: unknown, depth = 0): boolean {
  if (depth > MAX_ACTION_DEPTH + 1) return false;
  if (expected === null || typeof expected !== "object") return expected === actual;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((item, i) => sameJson(item, actual[i], depth + 1));
  }
  if (!isRecord(expected) || !isRecord(actual)) return false;
  const keys = definedKeys(expected);
  const actualKeys = definedKeys(actual);
  if (keys.length !== actualKeys.length) return false;
  return keys.every((k) => Object.hasOwn(actual, k) && sameJson(expected[k], actual[k], depth + 1));
}

function definedKeys(record: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(record).filter((k) => record[k] !== undefined);
}

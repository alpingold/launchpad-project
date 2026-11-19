/**
 * The reference text the site's own AI is given in every Build prompt: the rules a Game's file must
 * follow and the SDK's types. It comes from the SDK's reference text (`@boilergames/sdk/v1/reference`),
 * the same one the page for Creators' own AIs shows (/make), with the site's own limits, so the two
 * can never disagree.
 */
import { checkSteps, fileRules, SDK_TYPES } from "@boilergames/sdk/v1/reference";
import { GAME_LIMITS } from "../games.js";

/** The rules a file must follow, with the site's limits, one per line. */
export function rulesText(): string {
  return fileRules(GAME_LIMITS)
    .map((rule) => `- ${rule}`)
    .join("\n");
}

/**
 * What the Playtest does with the file, one step per line: the checks, without /make's last step,
 * which is about a Creator's own Uploads (how many an hour) and means nothing to a Build.
 */
export function playtestText(): string {
  return checkSteps(GAME_LIMITS)
    .map((step) => `- ${step}`)
    .join("\n");
}

/** The SDK's types, everything `@boilergames/sdk/v1` offers, as declarations. */
export function typesText(): string {
  return SDK_TYPES.trim();
}

/** One Part of the Kit, as the types text describes it, and where it can be shown. */
export interface KitPart {
  /** Its `kind`, as a View names it: "text", "button"... */
  readonly kind: string;
  /** The first sentence of its doc comment. */
  readonly purpose: string;
  readonly on: "screen and phone" | "phone only";
}

/** The doc comment just before `index` in `text`, as plain words, or "" if there is none. */
function commentBefore(text: string, index: number): string {
  const end = text.lastIndexOf("*/", index);
  if (end === -1 || text.slice(end + 2, index).trim() !== "") return "";
  const start = text.lastIndexOf("/**", end);
  return text
    .slice(start + 3, end)
    .replace(/^\s*\*\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The Kit's Parts by name and purpose, read from the SDK's types text itself, so what the Concept's
 * prompt says a Screen or a phone can show is what the SDK has. A Part is on the Screen if the
 * Screen's own list of Parts (`ScreenLeaf`) holds it; otherwise only a phone shows it.
 */
export function kitParts(): KitPart[] {
  const text = SDK_TYPES;
  const screenLeaf = /type ScreenLeaf = ([^;]+);/.exec(text)?.[1] ?? "";
  const showPart = /type ShowPart = ([^;]+);/.exec(text)?.[1] ?? "";
  const onScreen = new Set(`${screenLeaf} | ${showPart}`.split("|").map((name) => name.trim().replace(/<.*$/, "")));
  const parts: KitPart[] = [];
  for (const match of text.matchAll(/^export interface (\w+Part)\b[^{]*\{([\s\S]*?)^\}/gm)) {
    const [, name = "", body = ""] = match;
    const kind = /readonly kind: "(\w+)"/.exec(body)?.[1];
    if (kind === undefined || name === "RowPart") continue;
    const purpose = (commentBefore(text, match.index).split(/(?<=\.)\s/)[0] ?? "").trim();
    parts.push({ kind, purpose, on: onScreen.has(name) ? "screen and phone" : "phone only" });
  }
  return parts;
}

/** The declarations of the SDK's Look, from the types text: what a Concept's `look` must be. */
export function lookTypesText(): string {
  const text = SDK_TYPES;
  const pieces: string[] = [];
  for (const name of ["Hex", "LookColor", "Color"]) {
    const found = new RegExp(`^export type ${name}\\b[^;]*;`, "m").exec(text);
    if (found !== null) pieces.push(found[0]);
  }
  const look = /^export interface Look \{[\s\S]*?^\}/m.exec(text);
  if (look !== null) pieces.push(look[0]);
  return pieces.join("\n");
}

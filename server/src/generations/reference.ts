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
  /** Its doc comment's first paragraph: what it is and what it is for. */
  readonly purpose: string;
  readonly on: "screen and phone" | "phone only";
}

/** The doc comment just before `index` in `text`, its first paragraph as plain words, or "" if there is none. */
function commentBefore(text: string, index: number): string {
  const end = text.lastIndexOf("*/", index);
  if (end === -1 || text.slice(end + 2, index).trim() !== "") return "";
  const start = text.lastIndexOf("/**", end);
  const lines = text.slice(start + 3, end).split("\n").map((line) => line.replace(/^\s*\*\s?/, "").trim());
  const blank = lines.findIndex((line, at) => at > 0 && line === "" && lines.slice(0, at).some((before) => before !== ""));
  return (blank === -1 ? lines : lines.slice(0, blank)).join(" ").replace(/\s+/g, " ").trim();
}

/** The names in a type alias's union, such as `ShowPart | PicturePart<Action>`, without type arguments. */
function unionOf(text: string, alias: string): string[] {
  const found = new RegExp(`type ${alias}(?:<[^>]*>)? = ([^;]+);`).exec(text);
  if (found === null) throw new Error(`The SDK's types text has no ${alias}: kitParts must be taught the Kit's new shape`);
  return (found[1] ?? "").split("|").map((name) => name.trim().replace(/<.*$/, ""));
}

/**
 * The Kit's Parts by name and purpose, read from the SDK's types text itself, so what the Concept's
 * prompt says a Screen or a phone can show is what the SDK has. Every Part a Controller can hold
 * (`ControllerLeaf`, with `ShowPart` opened up) must be found, with a kind and a purpose, or this
 * throws: a Part can't silently go missing from the prompt. A Part is on the Screen when the
 * Screen's own list (`ScreenLeaf`) holds it.
 */
export function kitParts(): KitPart[] {
  const text = SDK_TYPES;
  const open = (names: readonly string[]) => names.flatMap((name) => (name === "ShowPart" ? unionOf(text, "ShowPart") : [name]));
  const everyPart = open(unionOf(text, "ControllerLeaf"));
  const onScreen = new Set(open(unionOf(text, "ScreenLeaf")));
  return everyPart.map((name): KitPart => {
    const declared = new RegExp(`^export interface ${name}\\b[^{]*\\{([\\s\\S]*?)^\\}`, "m").exec(text);
    const kind = declared === null ? undefined : /readonly kind: "(\w+)"/.exec(declared[1] ?? "")?.[1];
    const purpose = declared === null ? "" : commentBefore(text, declared.index);
    if (kind === undefined || purpose === "") throw new Error(`The SDK's types text has no kind or no doc comment for ${name}: kitParts must be taught it`);
    return { kind, purpose, on: onScreen.has(name) ? "screen and phone" : "phone only" };
  });
}

/**
 * The SDK's Look as the types text declares it, with the doc comments that give its rules (a colour
 * is "#rgb" or "#rrggbb"; the contrast each pair needs): what a Concept's `look` must be. Only what a
 * Look uses: the colour names a picture may use instead of a hex aren't allowed in a Look.
 */
export function lookTypesText(): string {
  const text = SDK_TYPES;
  const withComment = (pattern: RegExp, name: string): string => {
    const found = pattern.exec(text);
    if (found === null) throw new Error(`The SDK's types text has no ${name}: lookTypesText must be taught it`);
    const end = text.lastIndexOf("*/", found.index);
    const start = end === -1 || text.slice(end + 2, found.index).trim() !== "" ? found.index : text.lastIndexOf("/**", end);
    return text.slice(start, found.index + found[0].length);
  };
  return [withComment(/^export type Hex\b[^;]*;/m, "Hex"), withComment(/^export interface Look \{[\s\S]*?^\}/m, "Look")].join("\n");
}

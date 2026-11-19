/**
 * The Concept (BUILD-PLAN Step 29): the written design of a whole Game, drafted by the AI and approved
 * or edited by its Creator before any code is written. It is structured data, checked by
 * `checkConcept`, never free text: the Build's skeleton and the Playtest's check against the Concept
 * are made from its fields.
 *
 * The prompt says what the site is, what a phone and the Screen can show (the Kit's Parts, from the
 * SDK's reference text) and the fields. No example Concept and no example Game is ever shown to the
 * model: an example is what every answer then copies (the owner's rule).
 */
import type { Look } from "@boilergames/sdk/v1";
import { checkLook } from "@boilergames/sdk/v1/check";
import { blockedWordIn } from "../blocked-words.js";
import type { ChatMessage, Completion, ModelFailure } from "./model.js";
import { jsonObjectText, withoutThinking } from "./model.js";
import { MAX_INVALID_CONCEPTS } from "./numbers.js";
import { kitParts, lookTypesText } from "./reference.js";

export interface ConceptPhase {
  /** Lower-case letters, unique in the Concept: the Build's `Phase` type is made of these. */
  readonly id: string;
  readonly name: string;
  /** What the Screen shows during it. */
  readonly screen: string;
  /** What each Player does on their phone during it. */
  readonly phone: string;
  /** What ends it. */
  readonly ends: string;
}

export type Scoring = "none" | "points" | "winner";

export interface Concept {
  readonly title: string;
  readonly pitch: string;
  readonly players: { readonly min: number; readonly max: number };
  readonly phases: readonly ConceptPhase[];
  /** `none` is a real choice: a score only when the idea asks for one (story 33). */
  readonly scoring: { readonly kind: Scoring; readonly how: string };
  /** How long a Match is. */
  readonly length: string;
  readonly look: Look;
}

/** The limits of each field, in characters or in number. */
export const CONCEPT_LIMITS = {
  title: 60,
  pitch: 400,
  minPlayers: 1,
  maxPlayers: 16,
  minPhases: 1,
  maxPhases: 8,
  phaseId: 30,
  phaseName: 40,
  phaseScreen: 300,
  phasePhone: 300,
  phaseEnds: 200,
  scoringHow: 400,
  length: 200,
} as const;

const SCORINGS: readonly Scoring[] = ["none", "points", "winner"];
/** The most problems one check lists. */
const MAX_CONCEPT_PROBLEMS = 50;
const FIELDS = ["title", "pitch", "players", "phases", "scoring", "length", "look"];
const PHASE_FIELDS = ["id", "name", "screen", "phone", "ends"];

export type ConceptCheck = { readonly ok: true; readonly concept: Concept } | { readonly ok: false; readonly problems: readonly string[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks a Concept field by field, and lists every problem, each naming its field and its rule, so
 * the model (or the Creator editing it) can fix them all at once.
 */
export function checkConcept(value: unknown): ConceptCheck {
  const problems: string[] = [];
  if (!isRecord(value)) return { ok: false, problems: ["The Concept must be one JSON object with the fields title, pitch, players, phases, scoring, length and look."] };
  /** Fields it doesn't know, named (cut short: a name is the answer's own text). */
  const unknown = (where: string, record: Record<string, unknown>, known: readonly string[], of: string) => {
    for (const key of Object.keys(record)) if (!known.includes(key)) problems.push(`${where}${JSON.stringify(key.slice(0, 40))} is not a field of ${of}: leave it out.`);
  };
  unknown("", value, FIELDS, "a Concept");

  const text = (where: string, field: unknown, most: number): string => {
    if (typeof field !== "string" || field.trim() === "") {
      problems.push(`${where} must be text, and not empty.`);
      return "";
    }
    const trimmed = field.trim();
    if ([...trimmed].length > most) problems.push(`${where} must be at most ${most} characters (it is ${[...trimmed].length}).`);
    return trimmed;
  };

  const title = text("title", value["title"], CONCEPT_LIMITS.title);
  // The Game's about.title is held to 60 by the Playtest, which counts an emoji as 2: the Concept's
  // title must fit that too, or the Build is told to keep a title its check refuses.
  if ([...title].length <= CONCEPT_LIMITS.title && title.length > CONCEPT_LIMITS.title) {
    problems.push(`title must be at most ${CONCEPT_LIMITS.title} characters, counting each emoji as 2 (it is ${title.length}).`);
  }
  const pitch = text("pitch", value["pitch"], CONCEPT_LIMITS.pitch);
  // The title and pitch are what the Game's title and description come from: the same check as
  // publishing (blocked-words.ts), so a Concept never asks for a Game that couldn't be published.
  for (const [where, said] of [["title", title], ["pitch", pitch]] as const) {
    const blocked = blockedWordIn(said);
    if (blocked !== undefined) problems.push(`${where} has a word the site doesn't allow: "${blocked}". Use another word.`);
  }
  const length = text("length", value["length"], CONCEPT_LIMITS.length);

  let players = { min: 0, max: 0 };
  const rawPlayers = value["players"];
  if (!isRecord(rawPlayers) || !Number.isInteger(rawPlayers["min"]) || !Number.isInteger(rawPlayers["max"])) {
    problems.push(`players must be { "min": a whole number, "max": a whole number }, from ${CONCEPT_LIMITS.minPlayers} to ${CONCEPT_LIMITS.maxPlayers}.`);
  } else {
    unknown("players.", rawPlayers, ["min", "max"], "players");
    players = { min: rawPlayers["min"] as number, max: rawPlayers["max"] as number };
    if (players.min < CONCEPT_LIMITS.minPlayers || players.max > CONCEPT_LIMITS.maxPlayers) problems.push(`players.min and players.max must be from ${CONCEPT_LIMITS.minPlayers} to ${CONCEPT_LIMITS.maxPlayers}.`);
    if (players.min > players.max) problems.push("players.min must not be more than players.max.");
  }

  const phases: ConceptPhase[] = [];
  const rawPhases = value["phases"];
  if (!Array.isArray(rawPhases) || rawPhases.length < CONCEPT_LIMITS.minPhases || rawPhases.length > CONCEPT_LIMITS.maxPhases) {
    problems.push(`phases must be a list of ${CONCEPT_LIMITS.minPhases} to ${CONCEPT_LIMITS.maxPhases} phases.`);
  }
  // Each phase is checked even when there are too many, so one answer can fix everything at once.
  if (Array.isArray(rawPhases)) {
    const seen = new Set<string>();
    rawPhases.slice(0, CONCEPT_LIMITS.maxPhases + 4).forEach((phase: unknown, at) => {
      const where = `phases[${at}]`;
      if (!isRecord(phase)) return void problems.push(`${where} must be an object with the fields id, name, screen, phone and ends.`);
      unknown(`${where}.`, phase, PHASE_FIELDS, "a phase");
      const id = phase["id"];
      if (typeof id !== "string" || !/^[a-z]+$/.test(id) || id.length > CONCEPT_LIMITS.phaseId) problems.push(`${where}.id must be 1 to ${CONCEPT_LIMITS.phaseId} lower-case letters only, such as "vote".`);
      else if (seen.has(id)) problems.push(`${where}.id "${id}" is used by another phase: each id must be different.`);
      else seen.add(id);
      phases.push({
        id: typeof id === "string" ? id : "",
        name: text(`${where}.name`, phase["name"], CONCEPT_LIMITS.phaseName),
        screen: text(`${where}.screen`, phase["screen"], CONCEPT_LIMITS.phaseScreen),
        phone: text(`${where}.phone`, phase["phone"], CONCEPT_LIMITS.phasePhone),
        ends: text(`${where}.ends`, phase["ends"], CONCEPT_LIMITS.phaseEnds),
      });
    });
  }

  let scoring: Concept["scoring"] = { kind: "none", how: "" };
  const rawScoring = value["scoring"];
  if (!isRecord(rawScoring)) {
    problems.push('scoring must be { "kind": "none", "points" or "winner", "how": text }.');
  } else {
    unknown("scoring.", rawScoring, ["kind", "how"], "scoring");
    if (!SCORINGS.includes(rawScoring["kind"] as Scoring)) problems.push('scoring.kind must be "none", "points" or "winner".');
    scoring = { kind: rawScoring["kind"] as Scoring, how: text("scoring.how", rawScoring["how"], CONCEPT_LIMITS.scoringHow) };
  }

  let look: Look = {};
  const lookChecked = checkLook(value["look"]);
  if (lookChecked.ok) look = lookChecked.look;
  else for (const problem of lookChecked.problems) problems.push(problem.startsWith("look") ? `${problem}.` : `look: ${problem}.`);

  // At most MAX_PROBLEMS, as the SDK's own checks do: an answer full of junk gets a short list back.
  if (problems.length > MAX_CONCEPT_PROBLEMS) return { ok: false, problems: [...problems.slice(0, MAX_CONCEPT_PROBLEMS - 1), `...and ${problems.length - MAX_CONCEPT_PROBLEMS + 1} more problems. Fix these first.`] };
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, concept: { title, pitch, players, phases, scoring, length, look } };
}

// --- The prompt ----------------------------------------------------------------------------------

function systemText(): string {
  const parts = kitParts()
    .map((part) => `- ${part.kind} (${part.on}): ${part.purpose}`)
    .join("\n");
  return [
    "You design party games for BoilerGames, a site where a group plays together in one room. One shared screen (the Screen) shows the Game to everyone; each Player uses their own phone (the Controller) to take part. The Screen has no inputs: Players act only on their phones.",
    "",
    "A Game shows its Views with the site's Kit. These are the Parts a View can hold, and where:",
    parts,
    "",
    "You write a Concept: the design of a whole Game, before any code. Answer with one JSON object and nothing else, with exactly these fields:",
    `- "title": the Game's name, at most ${CONCEPT_LIMITS.title} characters.`,
    `- "pitch": what the Game is, in a few sentences, at most ${CONCEPT_LIMITS.pitch} characters.`,
    `- "players": { "min": whole number, "max": whole number }, from ${CONCEPT_LIMITS.minPlayers} to ${CONCEPT_LIMITS.maxPlayers}, min not more than max.`,
    `- "phases": a list of ${CONCEPT_LIMITS.minPhases} to ${CONCEPT_LIMITS.maxPhases} phases, in the order a Match goes through them. Each phase is an object:`,
    `  - "id": 1 to ${CONCEPT_LIMITS.phaseId} lower-case letters only, different for each phase;`,
    `  - "name": at most ${CONCEPT_LIMITS.phaseName} characters;`,
    `  - "screen": what the Screen shows during it, at most ${CONCEPT_LIMITS.phaseScreen} characters;`,
    `  - "phone": what each Player does on their phone during it, at most ${CONCEPT_LIMITS.phasePhone} characters;`,
    `  - "ends": what ends it (everyone has acted, a timer, a choice), at most ${CONCEPT_LIMITS.phaseEnds} characters.`,
    `- "scoring": { "kind": "none", "points" or "winner", "how": text at most ${CONCEPT_LIMITS.scoringHow} characters }. "none" is a real choice: add points or a winner only when the idea asks for them. "points" and "winner" must tell the Players apart when a Match ends (the site checks that they do); a Game where everyone wins or loses together is "none".`,
    `- "length": how long a Match takes, at most ${CONCEPT_LIMITS.length} characters.`,
    '- "look": the Game\'s own colours, typeface and corners, as the SDK\'s Look type below, which says how readable its colours must be.',
    "",
    lookTypesText(),
    "",
    "Every Player must always have something to do or see on their phone. A Player can leave at any moment, and the Game must go on without them.",
  ].join("\n");
}

/** The first draft's messages: the idea, and a note from the Creator when they asked for a redraft. */
export function conceptMessages(idea: string, redraft?: { readonly previous: Concept; readonly note: string }): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: systemText() },
    { role: "user", content: `The Creator's idea:\n${idea}` },
  ];
  if (redraft !== undefined) {
    messages.push({
      role: "user",
      content: `A Concept was drafted before:\n${JSON.stringify(redraft.previous, null, 2)}\n\nThe Creator asks for it to be redrafted, with this note:\n${redraft.note}\n\nAnswer with the whole new Concept, as one JSON object.`,
    });
  }
  return messages;
}

/** An invalid answer goes back with every problem listed. Only the latest answer is sent. */
function retryMessages(first: readonly ChatMessage[], answer: string, problems: readonly string[]): ChatMessage[] {
  return [
    ...first,
    // The answer without its thinking: only what it said goes back, which keeps the conversation short.
    { role: "assistant", content: withoutThinking(answer) },
    { role: "user", content: `That Concept can't be used. Fix every one of these problems and answer with the whole Concept again, as one JSON object:\n${problems.map((problem) => `- ${problem}`).join("\n")}` },
  ];
}

/** What an answer is, read as a Concept. */
export function readConcept(answer: string): ConceptCheck {
  const json = jsonObjectText(answer);
  if (json === undefined) return { ok: false, problems: ["The answer holds no JSON object. Answer with the Concept as one JSON object."] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { ok: false, problems: [`The answer's JSON can't be read: ${(error as Error).message}.`] };
  }
  return checkConcept(parsed);
}

export type Draft =
  | { readonly kind: "valid"; readonly concept: Concept }
  /** Every attempt was invalid: their problems, in order. */
  | { readonly kind: "invalid"; readonly attempts: readonly (readonly string[])[] }
  | { readonly kind: "failed"; readonly failure: ModelFailure };

/**
 * Drafts a Concept: asks the model, and sends an invalid answer back with its problems, at most
 * MAX_INVALID_CONCEPTS times. `ask` is how the pipeline asks the model (it counts each call and
 * writes it down before making it); `onAttempt` hears how each answer came out.
 */
export async function draftConcept(
  ask: (messages: readonly ChatMessage[]) => Promise<Completion>,
  idea: string,
  options: { readonly redraft?: { readonly previous: Concept; readonly note: string }; readonly onAttempt?: (problems: readonly string[]) => void } = {},
): Promise<Draft> {
  const first = conceptMessages(idea, options.redraft);
  let messages: readonly ChatMessage[] = first;
  const attempts: (readonly string[])[] = [];
  for (let attempt = 0; attempt < MAX_INVALID_CONCEPTS; attempt += 1) {
    const answer = await ask(messages);
    if (!answer.ok) return { kind: "failed", failure: answer.failure };
    const read = readConcept(answer.text);
    options.onAttempt?.(read.ok ? [] : read.problems);
    if (read.ok) return { kind: "valid", concept: read.concept };
    attempts.push(read.problems);
    messages = retryMessages(first, answer.text, read.problems);
  }
  return { kind: "invalid", attempts };
}

/** Why a Generation failed when every draft was invalid, in words a person can read. */
export function invalidConceptsReason(attempts: readonly (readonly string[])[]): string {
  const last = attempts.at(-1) ?? [];
  return `The AI couldn't write a usable Concept in ${attempts.length} tries. The last one's problems: ${last.slice(0, 5).join(" ")}${last.length > 5 ? ` (and ${last.length - 5} more)` : ""}`;
}

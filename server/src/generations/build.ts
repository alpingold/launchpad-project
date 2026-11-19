/**
 * The Build (BUILD-PLAN Step 31): the AI writes a Game's code, and the Playtest checks it; a failed
 * check goes back to the AI with every problem, a few times at most.
 *
 * - **The skeleton** is made from the Concept, never written by the model: the import, the `Phase`
 *   type (the Concept's phase ids), a state with `phase`, `about` filled in, and each function
 *   declared and left empty. It type-checks as it stands except for what is left to fill in.
 * - **The prompt:** the SDK's reference text (the rules and the types), how the Playtest will test
 *   the file, the Concept and the skeleton. It asks for the whole file in one code block. No example
 *   Game: an example is what every Game then copies (the owner's rule).
 * - **A failed check goes back** as the Concept, the model's last file and every problem with its
 *   line. Only the latest attempt is sent, so the conversation stays within what the model remembers.
 * - **Two kinds of failure.** Problems from the source, type or bundle stages are a *type fix*:
 *   cheap, and they don't use up a Build. Problems from playing are a *Build*. Both have a cap, and so
 *   has the whole Generation's count of model calls (numbers.ts).
 *
 * Only the Playtest runs the code the model writes, in its walled runner: this file only passes text.
 */
import type { Expect, PlaytestRunner, RunResult } from "@boilergames/playtest/client";
import type { Concept } from "./concept.js";
import type { ChatMessage, Completion, ModelFailure } from "./model.js";
import { longestCodeBlock } from "./model.js";
import { MAX_BUILDS, MAX_TYPE_FIXES_PER_BUILD } from "./numbers.js";
import { playtestText, rulesText, typesText } from "./reference.js";

/** What a generated Game's Playtest also checks (playtest/src/expect.ts): the Concept's phases, whether it has scoring, its Player count. */
export function expectOf(concept: Concept): Expect {
  return { phases: concept.phases.map((phase) => phase.id), scoring: concept.scoring.kind !== "none", players: concept.players };
}

// --- The skeleton --------------------------------------------------------------------------------

/** A comment's text, safe inside `/* ... *\/` (a Concept's words can't end the comment early). */
const commentSafe = (text: string) => text.replace(/\*\//g, "* /").replace(/\s+/g, " ").trim();

/**
 * The file the model starts from, made from the Concept. Its only type errors are the empty
 * functions, which must return a Step or a View: that is what is left to fill in.
 */
export function skeleton(concept: Concept): string {
  const phases = concept.phases.map((phase) => JSON.stringify(phase.id)).join(" | ");
  const phaseNotes = concept.phases.map((phase) => ` *   - ${phase.id}: ${commentSafe(phase.name)}`).join("\n");
  const about = JSON.stringify({ title: concept.title, players: concept.players, look: concept.look }, null, 2).replace(/\n/g, "\n  ");
  return `import { defineGame, type Context, type ControllerView, type Player, type ScreenView, type Step } from "@boilergames/sdk/v1";

/**
 * The Concept's phases, in the order a Match goes through them. state.phase is always one of them:
 * the Playtest checks that every one is reached.
${phaseNotes}
 */
type Phase = ${phases};

/** Everything the Game keeps between events, as plain data. Add what it needs; keep phase. */
interface State {
  readonly phase: Phase;
}

/** Everything a Player can do, as a union of objects told apart by type. Replace this one. */
type Action = { readonly type: "replaceMe" };

export default defineGame<State, Action>({
  about: ${about},

  start(ctx: Context): Step<State> {},

  onAction(state: State, player: Player, action: Action, ctx: Context): Step<State> {},

  onLeave(state: State, player: Player, ctx: Context): Step<State> {},

  screen(state: State, players: readonly Player[]): ScreenView {},

  controller(state: State, player: Player, players: readonly Player[]): ControllerView<Action> {},

  // Add onTimer(state, ctx) if the Game uses the timer, and onJoin(state, player, ctx) to take Players
  // who arrive during a Match.
});
`;
}

// --- The prompts ---------------------------------------------------------------------------------

function systemText(): string {
  return [
    "You write party games for BoilerGames, a site where a group plays together in one room: one shared screen (the Screen) shows the Game to everyone, and each Player uses their own phone (the Controller). A Game is one TypeScript file, written against the site's SDK.",
    "",
    "The rules the file must follow (the site checks every one):",
    rulesText(),
    "",
    "What the site's Playtest does with the file:",
    playtestText(),
    "For this Game it also checks that every one of the Concept's phases is reached (state.phase), that state.phase is never anything else, that scores move when the Concept has scoring, and that about.players is the Concept's.",
    "",
    'The SDK\'s types, everything "@boilergames/sdk/v1" offers. Use only these:',
    "",
    "```ts",
    typesText(),
    "```",
    "",
    "Answer with the whole file, in one TypeScript code block.",
  ].join("\n");
}

function conceptText(concept: Concept): string {
  return `The approved Concept:\n${JSON.stringify(concept, null, 2)}`;
}

/** The first Build's messages: the Concept and the skeleton. */
export function buildMessages(concept: Concept): ChatMessage[] {
  return [
    { role: "system", content: systemText() },
    { role: "user", content: `${conceptText(concept)}\n\nWrite the Game. Start from this file, keep its Phase type, its state's phase and its about, and fill in every function:\n\n\`\`\`ts\n${skeleton(concept)}\`\`\`` },
  ];
}

/** One problem, as the model is told it: its stage and line, then what is wrong. */
function problemLine(problem: { readonly stage: string; readonly message: string; readonly line?: number }): string {
  return `- ${problem.stage}${problem.line === undefined ? "" : `, line ${problem.line}`}: ${problem.message}`;
}

/** A failed check: the Concept (or the Revision's own context), the last file, and every problem. Only the latest attempt. */
export function fixMessages(context: string, lastFile: string, problems: readonly { readonly stage: string; readonly message: string; readonly line?: number }[]): ChatMessage[] {
  return [
    { role: "system", content: systemText() },
    {
      role: "user",
      content: `${context}\n\nThis is the file as it stands:\n\n\`\`\`ts\n${lastFile}\n\`\`\`\n\nThe site's check found these problems. Fix every one, and answer with the whole corrected file in one TypeScript code block:\n${problems.map(problemLine).join("\n")}`,
    },
  ];
}

// --- The loop ------------------------------------------------------------------------------------

type CheckProblem = { readonly stage: string; readonly message: string; readonly line?: number };

/** One thing the Build did, as it ends. */
export interface BuildStep {
  /** A Build (the first file, or one after a play failure) or a type fix. */
  readonly kind: "build" | "typeFix";
  /** Which Build it belongs to, from 1. */
  readonly build: number;
  /** How it came out. */
  readonly outcome: "passed" | "problems" | "noCode" | "modelFailed" | "checkFailed";
  readonly problems: readonly CheckProblem[];
}

/**
 * Where a Build stands: what the pipeline writes down (generations: builds, type_fixes, code) so a
 * restart carries on from the start of the stage it was in.
 */
export interface BuildProgress {
  /** Which Build this is, from 1. */
  readonly builds: number;
  /** Type fixes used in this Build. */
  readonly typeFixes: number;
  /** The last file the model wrote, if any. */
  readonly lastFile?: string;
  /** What the last check found, to go back with the last file. */
  readonly problems?: readonly CheckProblem[];
  /** A file written and not yet checked: the Build carries on at its Playtest. */
  readonly toCheck?: string;
}

export type BuildResult =
  | { readonly ok: true; readonly source: string; readonly bundle: string; readonly about: Extract<RunResult, { ok: true }>["about"]; readonly builds: number; readonly typeFixes: number }
  | { readonly ok: false; readonly reason: string; readonly failure?: ModelFailure; readonly lastFile?: string; readonly builds: number; readonly typeFixes: number };

export interface BuildOptions {
  /**
   * How the Build asks the model, for a Build or a type fix. The pipeline counts the call and writes
   * it down before making it, and answers `undefined` instead when the Generation has used all its
   * model calls.
   */
  readonly ask: (messages: readonly ChatMessage[], kind: BuildStep["kind"]) => Promise<Completion | undefined>;
  readonly playtest: PlaytestRunner;
  /** The first messages: buildMessages(concept), or a Revision's. */
  readonly first: readonly ChatMessage[];
  /** What a failed check goes back with, before the file: the Concept, or a Revision's request. */
  readonly context: string;
  /** What the Playtest also checks: a generated Game's Concept. None for a Revision of an Upload. */
  readonly expect?: Expect;
  /** Where to carry on from (a restart); the first Build if left out. */
  readonly from?: BuildProgress;
  /** Hears where the Build stands before each call to the model ("build") and each Playtest ("playtest"). */
  readonly onProgress?: (stage: "build" | "playtest", progress: BuildProgress) => void | Promise<void>;
  /** Hears each step, as it ends. */
  readonly onStep?: (step: BuildStep) => void | Promise<void>;
}

const NO_CODE = { stage: "source", message: "The answer has no code block. Answer with the whole file, in one TypeScript code block." } as const;

/** What goes to the model next: the first messages, or the last file with what its check found. */
function messagesFor(options: BuildOptions, progress: BuildProgress): readonly ChatMessage[] {
  if (progress.lastFile !== undefined) return fixMessages(options.context, progress.lastFile, progress.problems ?? []);
  // No file yet: the first messages, and if an answer came back with no code, a note saying so.
  return progress.problems === undefined ? options.first : withNote(options.first, "Answer with the whole file, in one TypeScript code block.");
}

/** Builds until the Playtest passes, or a cap ends it. */
export async function buildGame(options: BuildOptions): Promise<BuildResult> {
  let progress: BuildProgress = options.from ?? { builds: 1, typeFixes: 0 };
  const kindOf = (at: BuildProgress): BuildStep["kind"] => (at.typeFixes === 0 ? "build" : "typeFix");
  const ended = (reason: string, failure?: ModelFailure): BuildResult => ({
    ok: false,
    reason,
    builds: progress.builds,
    typeFixes: progress.typeFixes,
    ...(failure === undefined ? {} : { failure }),
    ...(progress.lastFile === undefined ? {} : { lastFile: progress.lastFile }),
  });
  for (;;) {
    const kind = kindOf(progress);
    let problems: readonly CheckProblem[];
    if (progress.toCheck === undefined) {
      await options.onProgress?.("build", progress);
      const answer = await options.ask(messagesFor(options, progress), kind);
      if (answer === undefined) return ended("The Generation used all the model calls it may make, before the Game passed its check.");
      if (!answer.ok) {
        await options.onStep?.({ kind, build: progress.builds, outcome: "modelFailed", problems: [] });
        return ended("GenAI Studio didn't answer.", answer.failure);
      }
      const code = longestCodeBlock(answer.text);
      if (code === undefined) {
        problems = [NO_CODE];
        await options.onStep?.({ kind, build: progress.builds, outcome: "noCode", problems });
      } else {
        progress = { builds: progress.builds, typeFixes: progress.typeFixes, lastFile: code, toCheck: code };
      }
    }
    if (progress.toCheck !== undefined) {
      const code = progress.toCheck;
      await options.onProgress?.("playtest", progress);
      const result = await options.playtest.run(code, options.expect === undefined ? {} : { expect: options.expect });
      if (result.ok) {
        await options.onStep?.({ kind, build: progress.builds, outcome: "passed", problems: [] });
        return { ok: true, source: code, bundle: result.bundle, about: result.about, builds: progress.builds, typeFixes: progress.typeFixes };
      }
      if ("checkFailed" in result) {
        await options.onStep?.({ kind, build: progress.builds, outcome: "checkFailed", problems: result.problems });
        return ended("The site's check itself failed, not the Game. Try again in a minute.");
      }
      problems = result.problems;
      await options.onStep?.({ kind, build: progress.builds, outcome: "problems", problems });
    } else {
      problems = [NO_CODE];
    }
    // Problems from playing use up a Build; the rest are a type fix, which doesn't.
    const base = { ...(progress.lastFile === undefined ? {} : { lastFile: progress.lastFile }), problems };
    if (problems.some((problem) => problem.stage === "play")) {
      if (progress.builds >= MAX_BUILDS) return ended(`The Game still failed its check after ${MAX_BUILDS} Builds.`);
      progress = { builds: progress.builds + 1, typeFixes: 0, ...base };
    } else {
      if (progress.typeFixes >= MAX_TYPE_FIXES_PER_BUILD) return ended(`The Game's code still had type errors after ${MAX_TYPE_FIXES_PER_BUILD} fixes in one Build.`);
      progress = { builds: progress.builds, typeFixes: progress.typeFixes + 1, ...base };
    }
  }
}

/** The first messages again, with a note at the end of the last: for an answer with no file yet to send back. */
function withNote(messages: readonly ChatMessage[], note: string): ChatMessage[] {
  const last = messages.at(-1);
  if (last === undefined) return [];
  return [...messages.slice(0, -1), { ...last, content: `${last.content}\n\nYour last answer had no code block. ${note}` }];
}

/** What a failed check goes back with for a Generation: its Concept. */
export function generationContext(concept: Concept): string {
  return conceptText(concept);
}

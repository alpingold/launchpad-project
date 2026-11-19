// The Build (BUILD-PLAN Step 31), with the scripted model and the real Playtest in a child process:
// a Build that passes first time; type errors fixed without using a Build; a play failure using one;
// each cap ending it with a reason; and the skeleton type-checking against the SDK.
import { childProcessRunner, readExpect, type RunResult } from "@boilergames/playtest/client";
import { describe, expect, test } from "vitest";
import { buildGame, buildMessages, expectOf, generationContext, skeleton, type BuildProgress, type BuildStep } from "./build.js";
import { CONCEPT_LIMITS, type Concept } from "./concept.js";
import { ScriptedModel, type ScriptedReply } from "./fake-model.js";
import { longestCodeBlock, type ChatMessage } from "./model.js";
import { MAX_BUILDS, MAX_TYPE_FIXES_PER_BUILD } from "./numbers.js";

const playtest = childProcessRunner();

/** A Concept (test data: never shown to a model). Two phases, points, 2 to 4 Players. */
const CONCEPT: Concept = {
  title: "Tap Vote",
  pitch: "Everyone taps; the third tap opens the vote, the sixth ends it.",
  players: { min: 2, max: 4 },
  phases: [
    { id: "write", name: "Tap */ to write", screen: "The taps so far", phone: "A Tap button", ends: "Three taps" },
    { id: "vote", name: "Tap to vote", screen: "The taps so far", phone: "A Tap button", ends: "Six taps" },
  ],
  scoring: { kind: "points", how: "A point per tap." },
  length: "A few seconds.",
  look: { colors: { background: "#101828", text: "#f8fafc", accent: "#f59e0b" }, font: "rounded", corners: "soft" },
};

/**
 * A file as the model might answer it, built on the skeleton's shape (test data: the model's side of
 * the conversation, never put in a prompt). Changed one way at a time.
 */
function answer(change: { top?: string; second?: string } = {}): string {
  const about = JSON.stringify({ title: CONCEPT.title, players: CONCEPT.players, look: CONCEPT.look });
  return `Here is the Game.

\`\`\`ts
import { defineGame, type Context, type ControllerView, type Player, type ScreenView, type Step } from "@boilergames/sdk/v1";
${change.top ?? ""}
type Phase = "write" | "vote";
interface State { readonly phase: Phase; readonly taps: number; readonly by: Readonly<Record<string, number>> }
type Action = { readonly type: "tap" };
export default defineGame<State, Action>({
  about: ${about},
  start(_ctx: Context): Step<State> { return { state: { phase: "write", taps: 0, by: {} } }; },
  onAction(state: State, player: Player, _action: Action, ctx: Context): Step<State> {
    const by = { ...state.by, [player.id]: (state.by[player.id] ?? 0) + 1 };
    const taps = state.taps + 1;
    if (taps >= 6) return { state: { ...state, taps, by }, end: { scores: Object.fromEntries(ctx.players.map((p) => [p.id, by[p.id] ?? 0])) } };
    return { state: { phase: taps >= 3 ? ${change.second ?? `"vote"`} : "write", taps, by } };
  },
  onLeave(state: State): Step<State> { return { state }; },
  screen(state: State): ScreenView { return { parts: [{ kind: "text", text: \`\${state.taps} taps\` }] }; },
  controller(): ControllerView<Action> { return { parts: [{ kind: "button", label: "Tap", action: { type: "tap" } }] }; },
});
\`\`\`
`;
}

const GOOD = answer();
const TYPE_ERROR = answer({ top: `const count: number = "three";` });
/** Never reaches the vote: a problem only playing finds, against the Concept. */
const PLAY_FAILURE = answer({ second: `"write"` });

/** A Build with the scripted model, every call counted against `calls` (the Generation's cap), every step heard. */
function build(script: readonly ScriptedReply[], calls = 100) {
  const model = new ScriptedModel(script);
  const steps: BuildStep[] = [];
  const run = buildGame({
    ask: async (messages: readonly ChatMessage[]) => (model.calls.length >= calls ? undefined : model.complete("key", messages)),
    playtest,
    first: buildMessages(CONCEPT),
    context: generationContext(CONCEPT),
    expect: expectOf(CONCEPT),
    onStep: (step) => void steps.push(step),
  });
  return { model, steps, run };
}

describe("the Build", () => {
  test("passes first time: one call, one Build, the Playtest's bundle and about", async () => {
    const { model, steps, run } = build([GOOD]);
    const result = await run;
    if (!result.ok) throw new Error(result.reason);
    expect(result).toMatchObject({ builds: 1, typeFixes: 0, about: { title: "Tap Vote", players: { min: 2, max: 4 } } });
    expect(result.bundle).toMatch(/^var BoilerGamesGame = /);
    expect(model.calls).toHaveLength(1);
    expect(steps).toEqual([{ kind: "build", build: 1, outcome: "passed", problems: [] }]);
  });

  test("type errors are fixed without using up a Build, the problem going back with its line and the last file", async () => {
    const { model, steps, run } = build([TYPE_ERROR, GOOD]);
    const result = await run;
    expect(result).toMatchObject({ ok: true, builds: 1, typeFixes: 1 });
    expect(steps.map((step) => [step.kind, step.build, step.outcome])).toEqual([
      ["build", 1, "problems"],
      ["typeFix", 1, "passed"],
    ]);
    const fix = model.calls[1]?.messages ?? [];
    expect(fix.map((message) => message.role)).toEqual(["system", "user"]);
    expect(fix[1]?.content).toContain(`"title": "Tap Vote"`);
    expect(fix[1]?.content).toContain(`const count: number = "three";`);
    expect(fix[1]?.content).toMatch(/- types, line 2: Type 'string' is not assignable to type 'number'\./);
  });

  test("a play failure uses up a Build, and goes back with the Concept's problem", async () => {
    const { model, steps, run } = build([PLAY_FAILURE, GOOD]);
    const result = await run;
    expect(result).toMatchObject({ ok: true, builds: 2, typeFixes: 0 });
    expect(steps.map((step) => [step.kind, step.build, step.outcome])).toEqual([
      ["build", 1, "problems"],
      ["build", 2, "passed"],
    ]);
    expect(model.calls[1]?.messages[1]?.content).toContain(`- play: No simulated Match ever reached the phase "vote"`);
  });

  test("an answer with no code block goes back as a problem, and costs a type fix", async () => {
    const { model, run } = build(["I can't write that.", GOOD]);
    expect(await run).toMatchObject({ ok: true, builds: 1, typeFixes: 1 });
    expect(model.calls[1]?.messages.at(-1)?.content).toMatch(/Your last answer had no code block\. Answer with the whole file, in one TypeScript code block\.$/);
  });
});

describe("type fixes and Builds together", () => {
  test("an answer with no code after a file goes back with what that file's check found, and costs a type fix", async () => {
    const { model, run } = build([TYPE_ERROR, "Here it is, fixed.", GOOD]);
    expect(await run).toMatchObject({ ok: true, builds: 1, typeFixes: 2 });
    const third = model.calls[2]?.messages[1]?.content ?? "";
    expect(third).toContain(`const count: number = "three";`);
    expect(third).toMatch(/- types, line 2: Type 'string' is not assignable to type 'number'\.\n- source: The answer has no code block\./);
  });

  test("a play failure starts a new Build, with its type fixes counted afresh", async () => {
    const { steps, run } = build([TYPE_ERROR, PLAY_FAILURE, TYPE_ERROR, GOOD]);
    expect(await run).toMatchObject({ ok: true, builds: 2, typeFixes: 1 });
    expect(steps.map((step) => [step.kind, step.build, step.outcome])).toEqual([
      ["build", 1, "problems"],
      ["typeFix", 1, "problems"],
      ["build", 2, "problems"],
      ["typeFix", 2, "passed"],
    ]);
  });
});

describe("carrying on from saved progress (a restart)", () => {
  test("it says where it stands before each call and each check, and carrying on from there asks exactly what it would have", async () => {
    const heard: [string, BuildProgress][] = [];
    const model = new ScriptedModel([TYPE_ERROR, GOOD]);
    const options = { playtest, first: buildMessages(CONCEPT), context: generationContext(CONCEPT), expect: expectOf(CONCEPT) };
    await buildGame({ ...options, ask: (messages) => model.complete("key", messages), onProgress: (stage, progress) => void heard.push([stage, progress]) });
    expect(heard.map(([stage, progress]) => [stage, progress.builds, progress.typeFixes])).toEqual([
      ["build", 1, 0],
      ["playtest", 1, 0],
      ["build", 1, 1],
      ["playtest", 1, 1],
    ]);
    // As if the server restarted just before the second call: carry on from what was saved there.
    const saved = heard[2]?.[1];
    if (saved === undefined) throw new Error("no progress heard");
    const again = new ScriptedModel([GOOD]);
    const result = await buildGame({ ...options, ask: (messages) => again.complete("key", messages), from: saved });
    expect(result).toMatchObject({ ok: true, builds: 1, typeFixes: 1 });
    expect(again.calls[0]?.messages).toEqual(model.calls[1]?.messages);
  });

  test("carrying on at a check runs the Playtest on the saved file without asking the model", async () => {
    const model = new ScriptedModel([]);
    const result = await buildGame({
      ask: (messages) => model.complete("key", messages),
      playtest,
      first: buildMessages(CONCEPT),
      context: generationContext(CONCEPT),
      expect: expectOf(CONCEPT),
      from: { builds: 2, typeFixes: 0, toCheck: longestCodeBlock(GOOD) ?? "" },
    });
    expect(result).toMatchObject({ ok: true, builds: 2, typeFixes: 0 });
    expect(model.calls).toHaveLength(0);
  });
});

describe("each cap ends the Build with a reason", () => {
  test(`${MAX_BUILDS} Builds that fail in play`, async () => {
    const { model, run } = build(Array(MAX_BUILDS + 2).fill(PLAY_FAILURE));
    const result = await run;
    expect(result).toMatchObject({ ok: false, reason: `The Game still failed its check after ${MAX_BUILDS} Builds.`, builds: MAX_BUILDS });
    expect(model.calls).toHaveLength(MAX_BUILDS);
    if (!result.ok) expect(result.lastFile).toContain(`taps >= 3 ? "write"`);
  });

  test(`${MAX_TYPE_FIXES_PER_BUILD} type fixes in one Build`, async () => {
    const { model, run } = build(Array(MAX_TYPE_FIXES_PER_BUILD + 3).fill(TYPE_ERROR));
    const result = await run;
    expect(result).toMatchObject({ ok: false, reason: `The Game's code still had type errors after ${MAX_TYPE_FIXES_PER_BUILD} fixes in one Build.`, builds: 1 });
    expect(model.calls).toHaveLength(1 + MAX_TYPE_FIXES_PER_BUILD);
  });

  test("the Generation's model calls", async () => {
    const { model, run } = build(Array(10).fill(TYPE_ERROR), 3);
    expect(await run).toMatchObject({ ok: false, reason: "The Generation used all the model calls it may make, before the Game passed its check." });
    expect(model.calls).toHaveLength(3);
  });

  test("a call that fails ends it, saying how", async () => {
    const { steps, run } = build([{ failure: "rateLimited" }]);
    expect(await run).toMatchObject({ ok: false, reason: "GenAI Studio didn't answer.", failure: "rateLimited" });
    expect(steps).toEqual([{ kind: "build", build: 1, outcome: "modelFailed", problems: [] }]);
  });

  test("a check that itself failed ends it without blaming the Game", async () => {
    const broken = childProcessRunner({ command: [process.execPath, "-e", "process.exit(3)"], log: () => undefined });
    const model = new ScriptedModel([GOOD]);
    const result = await buildGame({ ask: (messages) => model.complete("key", messages), playtest: broken, first: buildMessages(CONCEPT), context: generationContext(CONCEPT) });
    expect(result).toMatchObject({ ok: false, reason: "The site's check itself failed, not the Game.", checkFailed: true });
  });
});

describe("the skeleton and the prompt", () => {
  test("the skeleton type-checks against the SDK, its only errors being the functions left to fill in", async () => {
    const source = skeleton(CONCEPT);
    const result: RunResult = await playtest.run(source);
    if (result.ok || "checkFailed" in result) throw new Error("expected the skeleton's empty functions to be type errors");
    const lines = source.split("\n");
    const functions = ["start", "onAction", "onLeave", "screen", "controller"].map((name) => lines.findIndex((line) => line.trimStart().startsWith(`${name}(`)) + 1);
    expect(result.problems).toEqual(functions.map((line) => ({ stage: "types", line, message: "A function whose declared type is neither 'undefined', 'void', nor 'any' must return a value." })));
  });

  test("the skeleton holds the Concept's phases, about and Look, and a phase name can't end its comment", () => {
    const source = skeleton(CONCEPT);
    expect(source).toContain(`type Phase = "write" | "vote";`);
    expect(source).toContain(`"title": "Tap Vote"`);
    expect(source).toContain(`"accent": "#f59e0b"`);
    expect(source).toContain("Tap * / to write");
  });

  test("the prompt has the rules, the types, the Playtest's checks and the Concept, and no example Game", () => {
    const [system, user] = buildMessages(CONCEPT);
    expect(system?.content).toContain("function defineGame<State, Action");
    expect(system?.content).toContain("checks that every one of the Concept's phases is reached");
    expect(user?.content).toContain(JSON.stringify(CONCEPT, null, 2));
    expect(user?.content).toContain(skeleton(CONCEPT));
    const everything = `${system?.content}\n${user?.content}`;
    for (const example of ["Best Word", "Allotments", "Scribble Pick", "Sum It Up", "Three Taps"]) expect(everything).not.toContain(example);
  });

  test("the largest Concept's checks fit what the Playtest takes", () => {
    const phases = Array.from({ length: CONCEPT_LIMITS.maxPhases }, (_, i) => ({ ...CONCEPT.phases[0]!, id: "abcdefghij"[i]!.repeat(CONCEPT_LIMITS.phaseId) }));
    const largest: Concept = { ...CONCEPT, phases, players: { min: CONCEPT_LIMITS.minPlayers, max: CONCEPT_LIMITS.maxPlayers } };
    expect(readExpect(expectOf(largest))).toEqual({ ok: true, expect: expectOf(largest) });
  });
});

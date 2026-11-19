// The eval set (BUILD-PLAN Step 35), run on the scripted model: the report's numbers per idea and in
// all, and every problem from every step; the command, writing its report and refusing; and the
// plan: never live without --live and a key, and only to GenAI Studio.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childProcessRunner, type PlaytestRunner, type RunResult } from "@boilergames/playtest/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Clock } from "../rooms.js";
import { devFakeModel, FAKE_CONCEPT } from "./dev-fake.js";
import { EVAL_IDEAS, evalCommand, planEval, reportText, runEval, type EvalReport } from "./eval.js";
import { ScriptedModel } from "./fake-model.js";
import type { Model } from "./model.js";
import { SUGGESTED_BASE_URL, SUGGESTED_MODEL } from "./numbers.js";
import { REASONS } from "./pipeline.js";

const KEY = "sk-eval-test-0123456789ABCD";
const CONCEPT = JSON.stringify(FAKE_CONCEPT);
const CODE = "```ts\n// a Game\n```";
const PASSED: RunResult = { ok: true, bundle: "var BoilerGamesGame = (function() {})();", about: { title: "Tap Vote", players: { min: 2, max: 4 } }, sdkVersion: "v1" };
const TYPE_ERROR: RunResult = { ok: false, problems: [{ stage: "types", message: "Cannot find name 'tap'.", line: 4 }] };
const PLAY_PROBLEM: RunResult = { ok: false, problems: [{ stage: "play", message: "With 2 Players (seed 1): it never ends" }] };
const NO_JSON = "The answer holds no JSON object. Answer with the Concept as one JSON object.";

/** A Playtest answering from a list, then passing. */
function playtestOf(results: RunResult[]): PlaytestRunner {
  return { run: async () => results.shift() ?? PASSED };
}

/**
 * A clock that moves 10 seconds each time it is read, so every idea's time is known. The waits for a
 * busy GenAI Studio (minutes) end at once; the pipeline's hourly sweep never comes.
 */
function tickingClock(): Clock {
  let time = 1_800_000_000_000;
  return {
    now: () => (time += 10_000),
    setTimeout(run, ms) {
      if (ms <= 5 * 60_000) queueMicrotask(run);
      return () => undefined;
    },
  };
}

describe("the report", () => {
  test("per idea: passed or why not, Builds, type fixes in every Build, model calls, and every problem from every step; and the totals", async () => {
    const model = new ScriptedModel([
      // Idea 1: a Concept, then a file that passes.
      CONCEPT,
      CODE,
      // Idea 2: three answers holding no Concept.
      "no",
      "still no",
      "nope",
      // Idea 3: a Concept; a type error, fixed; a play failure (a new Build); a type error, fixed again.
      CONCEPT,
      CODE,
      CODE,
      CODE,
      CODE,
    ]);
    const report = await runEval({ model, playtest: playtestOf([PASSED, TYPE_ERROR, PLAY_PROBLEM, TYPE_ERROR, PASSED]), key: KEY, ideas: ["one", "two", "three"] });

    expect(report.ideas.map(({ idea, passed, builds, typeFixes, modelCalls, waits }) => ({ idea, passed, builds, typeFixes, modelCalls, waits }))).toEqual([
      { idea: "one", passed: true, builds: 1, typeFixes: 0, modelCalls: 2, waits: 0 },
      { idea: "two", passed: false, builds: 0, typeFixes: 0, modelCalls: 3, waits: 0 },
      // Two type fixes, one in each Build: not only the last Build's.
      { idea: "three", passed: true, builds: 2, typeFixes: 2, modelCalls: 5, waits: 0 },
    ]);
    expect(report.ideas[1]?.reason).toMatch(/^The AI couldn't write a usable Concept in 3 tries/);
    expect(report.ideas[1]?.steps.map((step) => step.problems)).toEqual([[{ stage: "concept", message: NO_JSON }], [{ stage: "concept", message: NO_JSON }], [{ stage: "concept", message: NO_JSON }]]);
    expect(report.ideas[2]?.steps.map((step) => [step.kind, step.outcome, step.problems?.length ?? 0])).toEqual([
      ["concept", "valid", 0],
      ["build", "answered", 0],
      ["playtest", "problems", 1],
      ["typeFix", "answered", 0],
      ["playtest", "problems", 1],
      ["build", "answered", 0],
      ["playtest", "problems", 1],
      ["typeFix", "answered", 0],
      ["playtest", "passed", 0],
    ]);
    // 3 Concept problems, and the third idea's 3 check problems.
    expect(report.totals).toEqual({ passed: 2, failed: 1, builds: 3, typeFixes: 2, modelCalls: 10, waits: 0, seconds: expect.any(Number), problems: 6 });
    expect(report.notRun).toEqual({ count: 0, why: null });

    const text = reportText(report);
    expect(text).toMatch(/^Passed 2 of 3\. Builds 3, type fixes 2, model calls 10, waits 0/);
    expect(text).toContain("3. PASSED: three");
    expect(text).toContain("     - types, line 4: Cannot find name 'tap'.");
    // The key is the model's to use, never the report's.
    expect(`${text}${JSON.stringify(report)}`).not.toContain(KEY);
    expect(model.calls.every((call) => call.key === KEY)).toBe(true);
  });

  test("each idea's time and the whole run's, on a clock the test reads", async () => {
    const report = await runEval({ model: devFakeModel(), playtest: playtestOf([]), key: KEY, ideas: ["one", "two"], clock: tickingClock() });
    expect(report.ideas.every((idea) => idea.seconds > 0)).toBe(true);
    expect(report.totals.seconds).toBeGreaterThanOrEqual(report.ideas.reduce((total, idea) => total + idea.seconds, 0));
  });

  test("busy GenAI Studio: each wait is counted; a rejected key stops the run, saying how many ideas weren't run", async () => {
    const model = new ScriptedModel([{ failure: "rateLimited" }, CONCEPT, CODE, { failure: "keyRejected" }]);
    const report = await runEval({ model, playtest: playtestOf([]), key: KEY, ideas: ["one", "two", "three", "four"], clock: tickingClock() });
    expect(report.ideas.map((idea) => [idea.passed, idea.waits])).toEqual([
      [true, 1],
      [false, 0],
    ]);
    expect(report.notRun).toEqual({ count: 2, why: REASONS.keyRejected });
    expect(reportText(report)).toContain(`Stopped early, 2 ideas not run: ${REASONS.keyRejected}`);
  });

  test("the whole set passes on the development fake through the real Playtest; and its 12 ideas are different, of one or two sentences", async () => {
    const report = await runEval({ model: devFakeModel(), playtest: childProcessRunner(), key: KEY });
    expect(report.totals).toMatchObject({ passed: 12, failed: 0, builds: 12, modelCalls: 24 });
    expect(new Set(EVAL_IDEAS).size).toBe(12);
    for (const idea of EVAL_IDEAS) expect(idea.split(/[.!?](\s|$)/).filter((part) => part.trim().length > 1).length).toBeLessThanOrEqual(2);
  }, 120_000);
});

describe("the command", () => {
  let folder: string;
  let lines: string[];
  let made: string[];
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "eval-"));
    lines = [];
    made = [];
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const parts = (runs: PlaytestRunner = playtestOf([])) => ({
    fakeModel: (): Model => (made.push("fake"), devFakeModel()),
    liveModel: (): Model => (made.push("live"), new ScriptedModel([{ failure: "keyRejected" }])),
    playtest: () => runs,
    log: (line: string) => void lines.push(line),
  });

  test("on the fake, it writes the report as text and JSON into --out's folder (made if need be)", async () => {
    const out = join(folder, "new", "reports");
    const env: Record<string, string | undefined> = {};
    expect(await evalCommand(["--out", out], env, parts())).toBe(0);
    expect(made).toEqual(["fake"]);
    const json = JSON.parse(await readFile(join(out, "eval-report.json"), "utf8")) as EvalReport;
    expect(json.totals).toMatchObject({ passed: 12, failed: 0 });
    expect(await readFile(join(out, "eval-report.txt"), "utf8")).toMatch(/^Passed 12 of 12\./);
  });

  test("--live without a key, or a folder missing after --out: it refuses, and makes no model", async () => {
    expect(await evalCommand(["--live"], {}, parts())).toBe(1);
    expect(await evalCommand(["--out", "--live"], { GENAI_KEY: KEY }, parts())).toBe(1);
    expect(made).toEqual([]);
    expect(lines).toEqual(["A live run needs the owner's key in GENAI_KEY. Nothing was run.", "--out needs a folder after it. Nothing was run."]);
  });

  test("it takes the key out of the environment before anything runs, so the Playtest's child processes never have it", async () => {
    const env: Record<string, string | undefined> = { GENAI_KEY: KEY };
    let seen: string | undefined = "not asked";
    const watching: PlaytestRunner = { run: async () => ((seen = env["GENAI_KEY"]), PASSED) };
    expect(await evalCommand(["--out", folder], env, parts(watching))).toBe(0);
    expect(seen).toBeUndefined();
    expect(env).not.toHaveProperty("GENAI_KEY");
  });

  test("a live run that meets a rejected key stops after that idea, and the report says so", async () => {
    expect(await evalCommand(["--live", "--out", folder], { GENAI_KEY: KEY }, parts())).toBe(0);
    expect(made).toEqual(["live"]);
    const json = JSON.parse(await readFile(join(folder, "eval-report.json"), "utf8")) as EvalReport;
    expect(json.ideas).toHaveLength(1);
    expect(json.notRun).toEqual({ count: 11, why: REASONS.keyRejected });
    expect(JSON.stringify(json) + lines.join("\n")).not.toContain(KEY);
  });
});

describe("the plan: live only when asked for, with a key, and only to GenAI Studio", () => {
  test("without --live: the fake, even with a key in the environment", () => {
    expect(planEval([], { GENAI_KEY: KEY, GENAI_BASE_URL: SUGGESTED_BASE_URL })).toEqual({ kind: "fake" });
  });

  test("--live without a key: refused", () => {
    expect(planEval(["--live"], {})).toEqual({ kind: "refused", why: "A live run needs the owner's key in GENAI_KEY. Nothing was run." });
    expect(planEval(["--live"], { GENAI_KEY: "" }).kind).toBe("refused");
  });

  test("--live with a key: a purdue.edu https address only, and the suggested ones when unset or empty", () => {
    expect(planEval(["--live"], { GENAI_KEY: KEY })).toEqual({ kind: "live", key: KEY, baseUrl: SUGGESTED_BASE_URL, model: SUGGESTED_MODEL });
    expect(planEval(["--live"], { GENAI_KEY: KEY, GENAI_BASE_URL: "", GENAI_MODEL: "" })).toEqual({ kind: "live", key: KEY, baseUrl: SUGGESTED_BASE_URL, model: SUGGESTED_MODEL });
    for (const address of ["http://genai.rcac.purdue.edu/api", "https://example.test/api", "https://purdue.edu.example.test/api", "fake", "not an address"]) {
      expect(planEval(["--live"], { GENAI_KEY: KEY, GENAI_BASE_URL: address }).kind).toBe("refused");
    }
  });
});

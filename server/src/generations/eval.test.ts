// The eval set (BUILD-PLAN Step 35), run on the scripted model: the report's numbers per idea and in
// all, and every problem from every step. And the plan: never live without --live and a key.
import type { PlaytestRunner, RunResult } from "@boilergames/playtest/client";
import { describe, expect, test } from "vitest";
import { FAKE_CONCEPT } from "./dev-fake.js";
import { EVAL_IDEAS, planEval, reportText, runEval } from "./eval.js";
import { ScriptedModel } from "./fake-model.js";
import { SUGGESTED_BASE_URL, SUGGESTED_MODEL } from "./numbers.js";

const KEY = "sk-eval-test-0123456789ABCD";
const CONCEPT = JSON.stringify(FAKE_CONCEPT);
const CODE = "```ts\n// a Game\n```";
const PASSED: RunResult = { ok: true, bundle: "var BoilerGamesGame = (function() {})();", about: { title: "Tap Vote", players: { min: 2, max: 4 } }, sdkVersion: "v1" };
const TYPE_ERROR: RunResult = { ok: false, problems: [{ stage: "types", message: "Cannot find name 'tap'.", line: 4 }] };

/** A Playtest answering from a list, then passing. */
function playtestOf(results: RunResult[]): PlaytestRunner {
  return { run: async () => results.shift() ?? PASSED };
}

describe("the report", () => {
  test("per idea: passed or why not, Builds, type fixes, model calls, and every problem from every step; and the totals", async () => {
    const model = new ScriptedModel([
      // Idea 1: a Concept, then a file that passes.
      CONCEPT,
      CODE,
      // Idea 2: three Concepts that aren't usable.
      "no",
      "still no",
      "nope",
      // Idea 3: a Concept, a file with a type error, then a fixed one.
      CONCEPT,
      CODE,
      CODE,
    ]);
    const report = await runEval({ model, playtest: playtestOf([PASSED, TYPE_ERROR, PASSED]), key: KEY, ideas: ["one", "two", "three"] });

    expect(report.ideas.map(({ idea, passed, builds, typeFixes, modelCalls }) => ({ idea, passed, builds, typeFixes, modelCalls }))).toEqual([
      { idea: "one", passed: true, builds: 1, typeFixes: 0, modelCalls: 2 },
      { idea: "two", passed: false, builds: 0, typeFixes: 0, modelCalls: 3 },
      { idea: "three", passed: true, builds: 1, typeFixes: 1, modelCalls: 3 },
    ]);
    expect(report.ideas[1]?.reason).toMatch(/^The AI couldn't write a usable Concept in 3 tries/);
    expect(report.ideas[2]?.steps.map((step) => [step.kind, step.outcome])).toEqual([
      ["concept", "valid"],
      ["build", "answered"],
      ["playtest", "problems"],
      ["typeFix", "answered"],
      ["playtest", "passed"],
    ]);
    expect(report.ideas[2]?.steps[2]?.problems).toEqual([{ stage: "types", message: "Cannot find name 'tap'.", line: 4 }]);
    // Every problem: the second idea's three Concepts' problems, and the third's type error.
    const conceptProblems = report.ideas[1]?.steps.reduce((total, step) => total + (step.problems?.length ?? 0), 0) ?? 0;
    expect(conceptProblems).toBeGreaterThanOrEqual(3);
    expect(report.totals).toEqual({ passed: 2, failed: 1, builds: 2, typeFixes: 1, modelCalls: 8, seconds: expect.any(Number), problems: conceptProblems + 1 });

    const text = reportText(report);
    expect(text).toMatch(/^Passed 2 of 3\. Builds 2, type fixes 1, model calls 8/);
    expect(text).toContain("3. PASSED: three");
    expect(text).toContain("     - types, line 4: Cannot find name 'tap'.");
    // The key is the model's to use, never the report's.
    expect(`${text}${JSON.stringify(report)}`).not.toContain(KEY);
    expect(model.calls.every((call) => call.key === KEY)).toBe(true);
  });

  test("the whole set, on the development fake, passes; and its ideas are 12, each different", async () => {
    const { devFakeModel } = await import("./dev-fake.js");
    const report = await runEval({ model: devFakeModel(), playtest: playtestOf([]), key: KEY });
    expect(report.totals).toMatchObject({ passed: 12, failed: 0, builds: 12, modelCalls: 24 });
    expect(new Set(EVAL_IDEAS).size).toBe(12);
  });
});

describe("the plan: live only when asked for, with a key", () => {
  test("without --live: the fake, even with a key in the environment", () => {
    expect(planEval([], { GENAI_KEY: KEY, GENAI_BASE_URL: SUGGESTED_BASE_URL })).toEqual({ kind: "fake" });
  });

  test("--live without a key: refused, and nothing runs", () => {
    expect(planEval(["--live"], {})).toEqual({ kind: "refused", why: "A live run needs the owner's key in GENAI_KEY. Nothing was run." });
    expect(planEval(["--live"], { GENAI_KEY: "" }).kind).toBe("refused");
  });

  test("--live with a key: GenAI Studio's https address only, the suggested model unless set", () => {
    expect(planEval(["--live"], { GENAI_KEY: KEY })).toEqual({ kind: "live", key: KEY, baseUrl: SUGGESTED_BASE_URL, model: SUGGESTED_MODEL });
    expect(planEval(["--live"], { GENAI_KEY: KEY, GENAI_BASE_URL: "http://example.test/api" }).kind).toBe("refused");
    expect(planEval(["--live"], { GENAI_KEY: KEY, GENAI_BASE_URL: "fake" }).kind).toBe("refused");
  });
});

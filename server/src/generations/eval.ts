/**
 * The eval set (BUILD-PLAN Step 35, story 53): 12 ideas as a Creator would type them, run one at a
 * time through the whole pipeline, approving the first usable Concept, so that every change to the
 * instructions or the Kit can be measured. The report says, per idea, whether it passed, its Builds,
 * type fixes, model calls and time, and every problem from every step; and the totals.
 *
 * It runs against the development fake unless told otherwise. Against the real GenAI Studio only
 * with --live and a key in the environment (planEval): a live run spends the owner's key, and is the
 * owner's decision each time. The tests never run it live.
 *
 * The ideas are what a Creator types: none is shown to the model as an example, and none copies an
 * Official game or any published one.
 */
import { randomBytes } from "node:crypto";
import type { PlaytestRunner } from "@boilergames/playtest/client";
import { createAccount, setDisplayName } from "../db/accounts.js";
import { IN_MEMORY, openDatabase } from "../db/database.js";
import { saveKey } from "../db/genai-keys.js";
import { generationById, stepsOf, type Step } from "../db/generations.js";
import type { Clock } from "../rooms.js";
import { keySecretFromBytes, SECRET_BYTES } from "./key-secret.js";
import type { Model } from "./model.js";
import { SUGGESTED_BASE_URL, SUGGESTED_MODEL } from "./numbers.js";
import { Pipeline } from "./pipeline.js";

/** Varied on purpose: drawing, words, bluffing, a board, speed, co-operative, no scoring, and more. */
export const EVAL_IDEAS: readonly string[] = [
  "Players take turns adding one line each to a shared drawing, trying to finish a monster together. The Screen shows the picture growing. There are no points.",
  "The Screen shows a long word. Everyone types as many shorter words made from its letters as they can in a minute; a word nobody else found scores double.",
  "One player secretly gets a different place from everyone else. Everyone answers a question about their place, then everyone votes on who the odd one out is.",
  "A race track of 20 squares on the Screen. Each turn everyone secretly picks 1, 2 or 3 on their phone and moves that far, but players who picked the same number stay put. First to the end wins.",
  "A colour's name appears on the Screen, written in a different colour. The first player to tap the colour the word says gets a point. Ten rounds.",
  "Everyone works together to find a secret number between 1 and 100. Each round every player makes one guess and the Screen says higher or lower for each. The group wins if anyone finds it within five rounds.",
  "A question appears on the Screen, like cats or dogs. Everyone picks an answer on their phone and the Screen shows how the room split. Just for fun: no winners.",
  "The Screen shows a word. Everyone types the first word it makes them think of, and you score a point for each other player who wrote the same word as you.",
  "Everyone secretly bids a number from 1 to 10. The highest bid nobody else made wins the round's points. Five rounds.",
  "The Screen flashes a sequence of arrows and players repeat it on their phones. Each round the sequence gets one longer; a mistake puts you out for the rest of the Match.",
  "The Screen asks how many of something there are, like windows in a tall building. Everyone guesses a number; the closest guess gets three points and the second closest one.",
  "Two teams race to tap as fast as they can for ten seconds; the team with more taps per player wins the round. Best of three rounds.",
];

/** What the eval was asked to run against: the fake, the real GenAI Studio, or nothing (why not). */
export type EvalPlan =
  | { readonly kind: "fake" }
  | { readonly kind: "live"; readonly key: string; readonly baseUrl: string; readonly model: string }
  | { readonly kind: "refused"; readonly why: string };

/**
 * Reads the command line and the environment. The real GenAI Studio only with --live and
 * GENAI_KEY; GENAI_BASE_URL and GENAI_MODEL if set, the suggested ones otherwise. Anything else is
 * the fake: a key in the environment alone never makes a live run.
 */
export function planEval(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): EvalPlan {
  if (!argv.includes("--live")) return { kind: "fake" };
  const key = env["GENAI_KEY"] ?? "";
  if (key === "") return { kind: "refused", why: "A live run needs the owner's key in GENAI_KEY. Nothing was run." };
  const baseUrl = env["GENAI_BASE_URL"] ?? SUGGESTED_BASE_URL;
  if (baseUrl === "fake" || !baseUrl.startsWith("https://")) return { kind: "refused", why: "A live run needs GENAI_BASE_URL to be GenAI Studio's https address. Nothing was run." };
  return { kind: "live", key, baseUrl, model: env["GENAI_MODEL"] ?? SUGGESTED_MODEL };
}

export interface IdeaReport {
  readonly idea: string;
  readonly passed: boolean;
  /** Why it didn't pass: the Generation's reason, or the Concept never came. */
  readonly reason: string | null;
  readonly builds: number;
  readonly typeFixes: number;
  readonly modelCalls: number;
  readonly seconds: number;
  /** Every step, with every problem it found. */
  readonly steps: readonly Step[];
}

export interface EvalReport {
  readonly ideas: readonly IdeaReport[];
  readonly totals: {
    readonly passed: number;
    readonly failed: number;
    readonly builds: number;
    readonly typeFixes: number;
    readonly modelCalls: number;
    readonly seconds: number;
    readonly problems: number;
  };
}

export interface EvalOptions {
  readonly model: Model;
  readonly playtest: PlaytestRunner;
  /** The key the calls are made with: the owner's for a live run. Never written into the report. */
  readonly key: string;
  readonly ideas?: readonly string[];
  readonly clock?: Clock;
  /** Hears a line as each idea starts and ends. */
  readonly log?: (line: string) => void;
}

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout(run, ms) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

/** Runs each idea through the pipeline, one at a time, in a database of its own in memory. */
export async function runEval(options: EvalOptions): Promise<EvalReport> {
  const clock = options.clock ?? systemClock;
  const log = options.log ?? (() => undefined);
  const database = openDatabase({ file: IN_MEMORY, log: () => undefined });
  const keySecret = keySecretFromBytes(randomBytes(SECRET_BYTES));
  /** An account of its own for each idea, with the key: an account may start only a few Generations a day. */
  const accountFor = (n: number): string => {
    const id = `eval-${n + 1}`;
    createAccount(database, { id, email: `eval-${n + 1}@purdue.edu`, createdAt: Math.floor(clock.now() / 1000) });
    setDisplayName(database, id, `Eval ${n + 1}`, `eval ${n + 1}`);
    saveKey(database, id, { sealed: keySecret.seal(id, options.key), last4: options.key.slice(-4), savedAt: Math.floor(clock.now() / 1000) });
    return id;
  };
  const pipeline = new Pipeline({ database, model: options.model, keySecret, playtest: options.playtest, clock, log });
  const reports: IdeaReport[] = [];
  try {
    for (const [n, idea] of (options.ideas ?? EVAL_IDEAS).entries()) {
      log(`Idea ${n + 1}: started`);
      const accountId = accountFor(n);
      const started = clock.now();
      const result = pipeline.start(accountId, idea);
      if (!result.ok) throw new Error(`the pipeline refused idea ${n + 1}: ${result.error}`);
      const id = result.generation.id;
      // The first usable Concept is approved as it is.
      let state = await settle(pipeline, () => generationById(database, id)?.state);
      if (state === "review") {
        const approved = pipeline.approve(accountId, id);
        if (!approved.ok) throw new Error(`the pipeline refused to approve idea ${n + 1}: ${approved.error}`);
        state = await settle(pipeline, () => generationById(database, id)?.state);
      }
      const done = generationById(database, id);
      if (done === undefined) throw new Error(`idea ${n + 1}'s Generation is gone`);
      reports.push({
        idea,
        passed: done.state === "ready",
        reason: done.state === "ready" ? null : (done.reason ?? `It stopped in ${done.state}.`),
        builds: done.builds,
        typeFixes: done.typeFixes,
        modelCalls: done.modelCalls,
        seconds: Math.round((clock.now() - started) / 1000),
        steps: stepsOf(database, id),
      });
      log(`Idea ${n + 1}: ${done.state === "ready" ? "passed" : `failed (${done.reason ?? done.state})`}`);
    }
  } finally {
    pipeline.stop();
    database.close();
  }
  const sum = (pick: (report: IdeaReport) => number) => reports.reduce((total, report) => total + pick(report), 0);
  return {
    ideas: reports,
    totals: {
      passed: reports.filter((report) => report.passed).length,
      failed: reports.filter((report) => !report.passed).length,
      builds: sum((report) => report.builds),
      typeFixes: sum((report) => report.typeFixes),
      modelCalls: sum((report) => report.modelCalls),
      seconds: sum((report) => report.seconds),
      problems: sum((report) => report.steps.reduce((total, step) => total + (step.problems?.length ?? 0), 0)),
    },
  };
}

/** Waits until the pipeline has nothing to work on, and says what state the Generation is in. */
async function settle(pipeline: Pipeline, state: () => string | undefined): Promise<string | undefined> {
  await pipeline.settled();
  return state();
}

/** The report as text a person reads: a line per idea, the totals, then every problem of every step. */
export function reportText(report: EvalReport): string {
  const lines = [`Passed ${report.totals.passed} of ${report.ideas.length}. Builds ${report.totals.builds}, type fixes ${report.totals.typeFixes}, model calls ${report.totals.modelCalls}, ${report.totals.seconds} s, ${report.totals.problems} problems in all.`, ""];
  for (const [n, idea] of report.ideas.entries()) {
    lines.push(`${n + 1}. ${idea.passed ? "PASSED" : "FAILED"}: ${idea.idea}`);
    lines.push(`   Builds ${idea.builds}, type fixes ${idea.typeFixes}, model calls ${idea.modelCalls}, ${idea.seconds} s.${idea.reason === null ? "" : ` ${idea.reason}`}`);
    for (const step of idea.steps) {
      lines.push(`   Step ${step.number} (${step.kind}): ${step.outcome ?? "under way"}`);
      for (const problem of step.problems ?? []) lines.push(`     - ${problem.stage}${problem.line === undefined ? "" : `, line ${problem.line}`}: ${problem.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

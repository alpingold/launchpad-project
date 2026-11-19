/**
 * The eval set (BUILD-PLAN Step 35, story 53): 12 ideas as a Creator would type them, run one at a
 * time through the whole pipeline, approving the first usable Concept, so that every change to the
 * instructions or the Kit can be measured. The report says, per idea, whether it passed, its Builds,
 * type fixes, model calls, waits for GenAI Studio and time, and every problem from every step; and
 * the totals. It is written again as each idea ends, so a run cut short keeps what it found.
 *
 * It runs against the development fake unless told otherwise. Against the real GenAI Studio only
 * with --live and a key in the environment (planEval): a live run spends the owner's key, and is the
 * owner's decision each time. It then stops at the first rejected key or outage, rather than spend
 * calls on the ideas left. The tests never run it live.
 *
 * The ideas are what a Creator types: none is shown to the model as an example, and none copies an
 * Official game or any published one.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlaytestRunner } from "@boilergames/playtest/client";
import { createAccount, setDisplayName } from "../db/accounts.js";
import { IN_MEMORY, openDatabase } from "../db/database.js";
import { saveKey } from "../db/genai-keys.js";
import { generationById, stepsOf, type Step } from "../db/generations.js";
import type { Clock } from "../rooms.js";
import { keySecretFromBytes, SECRET_BYTES } from "./key-secret.js";
import type { Model } from "./model.js";
import { SUGGESTED_BASE_URL, SUGGESTED_MODEL } from "./numbers.js";
import { Pipeline, REASONS } from "./pipeline.js";

/** Varied on purpose: drawing, words, bluffing, a board, speed, co-operative, no scoring, and more. One or two sentences each. */
export const EVAL_IDEAS: readonly string[] = [
  "Players take turns adding one line each to a shared drawing of a monster, which the Screen shows growing. There are no points.",
  "The Screen shows a long word, and everyone types shorter words made from its letters for a minute; a word nobody else found scores double.",
  "Each round players are paired at random and secretly choose to share or grab a pot of points: both share and they split it, one grabs and takes it all, both grab and nobody scores.",
  "Everyone races along a track of 20 squares by secretly picking 1, 2 or 3 each turn, but players who picked the same number stay put.",
  "A colour's name appears on the Screen, written in another colour, and the first player to tap the colour the word names gets a point.",
  "Together the group hunts for a secret number from 1 to 100, each Player guessing once a round while the Screen says higher or lower, and wins if anyone finds it within five rounds.",
  "A question like cats or dogs appears on the Screen, everyone picks an answer, and the Screen shows how the room split, with no winners.",
  "A category such as fruit appears on the Screen and everyone types one thing in it; you score only if nobody else typed the same thing.",
  "Everyone secretly bids a number from 1 to 10, and the highest bid that nobody else made wins the round.",
  "The Screen shows a jumble of shapes for five seconds and hides it, then everyone answers how many triangles there were.",
  "The Screen asks how many of something there are, like windows in a tall building, and the closest guess gets three points.",
  "Two teams tap as fast as they can for ten seconds, and the team with more taps per player wins the round.",
];

/** Where a live run may send the key: GenAI Studio is Purdue's, so a purdue.edu address over https. */
const GENAI_HOST = /(^|\.)purdue\.edu$/;

/** What the eval was asked to run against: the fake, the real GenAI Studio, or nothing (why not). */
export type EvalPlan =
  | { readonly kind: "fake" }
  | { readonly kind: "live"; readonly key: string; readonly baseUrl: string; readonly model: string }
  | { readonly kind: "refused"; readonly why: string };

/**
 * Reads the command line and the environment. The real GenAI Studio only with --live and GENAI_KEY,
 * at a purdue.edu https address: GENAI_BASE_URL and GENAI_MODEL if set, and for the eval alone the
 * suggested ones otherwise. Anything else is the fake: a key in the environment never makes a live run.
 */
export function planEval(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): EvalPlan {
  if (!argv.includes("--live")) return { kind: "fake" };
  const key = env["GENAI_KEY"] ?? "";
  if (key === "") return { kind: "refused", why: "A live run needs the owner's key in GENAI_KEY. Nothing was run." };
  const baseUrl = env["GENAI_BASE_URL"] || SUGGESTED_BASE_URL;
  let url: URL | undefined;
  try {
    url = new URL(baseUrl);
  } catch {
    url = undefined;
  }
  if (url?.protocol !== "https:" || !GENAI_HOST.test(url.hostname)) {
    return { kind: "refused", why: "A live run needs GENAI_BASE_URL to be GenAI Studio's https address at purdue.edu. Nothing was run." };
  }
  return { kind: "live", key, baseUrl, model: env["GENAI_MODEL"] || SUGGESTED_MODEL };
}

export interface IdeaReport {
  readonly idea: string;
  readonly passed: boolean;
  /** Why it didn't pass: the Generation's reason, or why it couldn't start. */
  readonly reason: string | null;
  readonly builds: number;
  /** Type fixes in all its Builds. */
  readonly typeFixes: number;
  readonly modelCalls: number;
  /** Calls GenAI Studio answered busy or not at all: each was waited out, and counts in its time. */
  readonly waits: number;
  readonly seconds: number;
  /** Every step, with every problem it found. */
  readonly steps: readonly Step[];
}

export interface EvalReport {
  readonly ideas: readonly IdeaReport[];
  /** Ideas not run, because the run stopped early (a rejected key, or GenAI Studio down), and why. */
  readonly notRun: { readonly count: number; readonly why: string | null };
  readonly totals: {
    readonly passed: number;
    readonly failed: number;
    readonly builds: number;
    readonly typeFixes: number;
    readonly modelCalls: number;
    readonly waits: number;
    /** The whole run, start to end. */
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
  /**
   * The system clock unless a test passes its own. Its timers must fire: the pipeline waits on them
   * while GenAI Studio is busy.
   */
  readonly clock?: Clock;
  /** Hears a line as each idea starts and ends. */
  readonly log?: (line: string) => void;
  /** Hears the report so far as each idea ends: the command writes it out each time. */
  readonly onIdea?: (report: EvalReport) => void;
}

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout(run, ms) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

/** The reasons that say GenAI Studio itself can't be used now: the run stops, rather than spend calls on the rest. */
const STOPS_THE_RUN: readonly string[] = [REASONS.keyRejected, REASONS.unavailable];

/** Runs each idea through the pipeline, one at a time, in a database of its own in memory. */
export async function runEval(options: EvalOptions): Promise<EvalReport> {
  const clock = options.clock ?? systemClock;
  const log = options.log ?? (() => undefined);
  const ideas = options.ideas ?? EVAL_IDEAS;
  const began = clock.now();
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
  let stoppedBecause: string | null = null;
  const report = (): EvalReport => summed(reports, stoppedBecause === null ? 0 : ideas.length - reports.length, stoppedBecause, Math.round((clock.now() - began) / 1000));
  try {
    for (const [n, idea] of ideas.entries()) {
      log(`Idea ${n + 1}: started`);
      const started = clock.now();
      const accountId = accountFor(n);
      const result = pipeline.start(accountId, idea);
      if (result.ok) {
        const id = result.generation.id;
        // The first usable Concept is approved as it is.
        await pipeline.settled();
        const approved = generationById(database, id)?.state === "review" ? pipeline.approve(accountId, id) : undefined;
        if (approved?.ok === false) log(`Idea ${n + 1}: its Concept couldn't be approved: ${approved.error}`);
        await pipeline.settled();
      }
      const done = result.ok ? generationById(database, result.generation.id) : undefined;
      const steps = done === undefined ? [] : stepsOf(database, done.id);
      reports.push({
        idea,
        passed: done?.state === "ready",
        reason: !result.ok ? `It couldn't start: ${result.error}` : done?.state === "ready" ? null : (done?.reason ?? `It stopped in ${done?.state ?? "nowhere"}.`),
        builds: done?.builds ?? 0,
        typeFixes: steps.filter((step) => step.kind === "typeFix").length,
        modelCalls: done?.modelCalls ?? 0,
        waits: steps.filter((step) => step.outcome === "rateLimited" || step.outcome === "unavailable").length,
        seconds: Math.round((clock.now() - started) / 1000),
        steps,
      });
      log(`Idea ${n + 1}: ${done?.state === "ready" ? "passed" : `failed (${reports.at(-1)?.reason ?? "?"})`}`);
      if (done?.reason !== null && done?.reason !== undefined && STOPS_THE_RUN.includes(done.reason)) stoppedBecause = done.reason;
      options.onIdea?.(report());
      if (stoppedBecause !== null) {
        log(`Stopped: ${stoppedBecause}`);
        break;
      }
    }
  } finally {
    pipeline.stop();
    database.close();
  }
  return report();
}

function summed(reports: readonly IdeaReport[], notRun: number, why: string | null, seconds: number): EvalReport {
  const sum = (pick: (report: IdeaReport) => number) => reports.reduce((total, report) => total + pick(report), 0);
  return {
    ideas: reports,
    notRun: { count: notRun, why },
    totals: {
      passed: reports.filter((report) => report.passed).length,
      failed: reports.filter((report) => !report.passed).length,
      builds: sum((report) => report.builds),
      typeFixes: sum((report) => report.typeFixes),
      modelCalls: sum((report) => report.modelCalls),
      waits: sum((report) => report.waits),
      seconds,
      problems: sum((report) => report.steps.reduce((total, step) => total + (step.problems?.length ?? 0), 0)),
    },
  };
}

/** The report as text a person reads: the totals, then each idea with every problem of every step. */
export function reportText(report: EvalReport): string {
  const { totals } = report;
  const lines = [
    `Passed ${totals.passed} of ${report.ideas.length}. Builds ${totals.builds}, type fixes ${totals.typeFixes}, model calls ${totals.modelCalls}, waits ${totals.waits}, ${totals.seconds} s, ${totals.problems} problems in all.`,
    ...(report.notRun.count === 0 ? [] : [`Stopped early, ${report.notRun.count} ideas not run: ${report.notRun.why ?? ""}`]),
    "",
  ];
  for (const [n, idea] of report.ideas.entries()) {
    lines.push(`${n + 1}. ${idea.passed ? "PASSED" : "FAILED"}: ${idea.idea}`);
    lines.push(`   Builds ${idea.builds}, type fixes ${idea.typeFixes}, model calls ${idea.modelCalls}, waits ${idea.waits}, ${idea.seconds} s.${idea.reason === null ? "" : ` ${idea.reason}`}`);
    for (const step of idea.steps) {
      lines.push(`   Step ${step.number} (${step.kind}): ${step.outcome ?? "under way"}`);
      for (const problem of step.problems ?? []) lines.push(`     - ${problem.stage}${problem.line === undefined ? "" : `, line ${problem.line}`}: ${problem.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** What the command needs from the world, so a test can give it its own. */
export interface EvalCommandParts {
  readonly fakeModel: () => Model;
  readonly liveModel: (baseUrl: string, model: string) => Model;
  readonly playtest: () => PlaytestRunner;
  readonly log: (line: string) => void;
  readonly clock?: Clock;
}

/**
 * The eval command (server/src/eval.ts): reads its plan, runs, and writes eval-report.txt and
 * eval-report.json into --out's folder (the current one unless given) after every idea. Its exit
 * code: 0 when it ran, 1 when it refused.
 *
 * Before anything runs, GENAI_KEY is taken out of `env`: the Playtest's runner is a child process
 * that would otherwise inherit it, and the Games it plays are code the model wrote.
 */
export async function evalCommand(argv: readonly string[], env: Record<string, string | undefined>, parts: EvalCommandParts): Promise<number> {
  const plan = planEval(argv, env);
  delete env["GENAI_KEY"];
  if (plan.kind === "refused") {
    parts.log(plan.why);
    return 1;
  }
  const at = argv.indexOf("--out");
  const folder = at < 0 ? "." : argv[at + 1];
  if (folder === undefined || folder.startsWith("--")) {
    parts.log("--out needs a folder after it. Nothing was run.");
    return 1;
  }
  mkdirSync(folder, { recursive: true });
  const write = (report: EvalReport) => {
    writeFileSync(join(folder, "eval-report.txt"), reportText(report));
    writeFileSync(join(folder, "eval-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  };
  parts.log(plan.kind === "live" ? `A live run against ${plan.baseUrl}, model ${plan.model}.` : "A run against the development fake.");
  const report = await runEval({
    model: plan.kind === "live" ? parts.liveModel(plan.baseUrl, plan.model) : parts.fakeModel(),
    playtest: parts.playtest(),
    key: plan.kind === "live" ? plan.key : "fake-eval-key-0000",
    log: parts.log,
    onIdea: write,
    ...(parts.clock === undefined ? {} : { clock: parts.clock }),
  });
  write(report);
  parts.log(`Passed ${report.totals.passed} of ${report.ideas.length}. The report is in ${join(folder, "eval-report.txt")}.`);
  return 0;
}

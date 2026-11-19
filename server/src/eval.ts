/**
 * Runs the eval set (generations/eval.ts) and writes its report. From the release's folder or the
 * workspace, after a build:
 *
 *   node server/dist/eval.js                  the development fake: nothing leaves this machine
 *   GENAI_KEY=... node server/dist/eval.js --live    the real GenAI Studio, with that key
 *
 * A live run spends the owner's GenAI Studio key on 12 Generations, and is the owner's decision each
 * time (BUILD-PLAN Step 35): without both --live and GENAI_KEY it refuses, and never runs live by
 * accident. The key goes only to GenAI Studio: never into the report, a log line or an error.
 *
 * The report is written to eval-report.txt and eval-report.json in the current folder, or the
 * folder given with --out <folder>. Each Game's code is checked by the Playtest in a child process,
 * as in development: there is no wall around it, which is fine for Games the eval's own model wrote.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { childProcessRunner } from "@boilergames/playtest/client";
import { devFakeModel } from "./generations/dev-fake.js";
import { planEval, reportText, runEval } from "./generations/eval.js";
import { genaiModel } from "./generations/model.js";

const plan = planEval(process.argv.slice(2), process.env);
if (plan.kind === "refused") {
  console.error(plan.why);
  process.exit(1);
}
const at = process.argv.indexOf("--out");
const folder = at >= 0 ? (process.argv[at + 1] ?? ".") : ".";

console.log(plan.kind === "live" ? `A live run against ${plan.baseUrl}, model ${plan.model}.` : "A run against the development fake.");
const report = await runEval({
  model: plan.kind === "live" ? genaiModel({ baseUrl: plan.baseUrl, model: plan.model }) : devFakeModel(),
  playtest: childProcessRunner(),
  key: plan.kind === "live" ? plan.key : "fake-eval-key-0000",
  log: (line) => console.log(line),
});
writeFileSync(join(folder, "eval-report.txt"), reportText(report));
writeFileSync(join(folder, "eval-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Passed ${report.totals.passed} of ${report.ideas.length}. The report is in ${join(folder, "eval-report.txt")}.`);

/**
 * Runs the eval set (generations/eval.ts, evalCommand) and writes its report. After a build:
 *
 *   npm run eval -w @boilergames/server                 the development fake: nothing leaves this machine
 *   GENAI_KEY=... npm run eval -w @boilergames/server -- --live    the real GenAI Studio, with that key
 *
 * A live run spends the owner's GenAI Studio key on 12 Generations, and is the owner's decision each
 * time (BUILD-PLAN Step 35): without both --live and GENAI_KEY it refuses, and never runs live by
 * accident. The key goes only to GenAI Studio: it is taken out of the environment before anything
 * runs, so the Playtest's child processes, which run the code the model wrote, never have it.
 *
 * The report is written to eval-report.txt and eval-report.json in the current folder, or the
 * folder given with --out <folder>, after every idea. Each Game is checked by the Playtest in a child
 * process, as in development: there is no wall around it.
 */
import { childProcessRunner } from "@boilergames/playtest/client";
import { devFakeModel } from "./generations/dev-fake.js";
import { evalCommand } from "./generations/eval.js";
import { genaiModel } from "./generations/model.js";

process.exitCode = await evalCommand(process.argv.slice(2), process.env, {
  fakeModel: devFakeModel,
  liveModel: (baseUrl, model) => genaiModel({ baseUrl, model }),
  playtest: () => childProcessRunner(),
  log: (line) => console.log(line),
});

/**
 * Part of `npm run build`: the SDK's reference text (`@boilergames/sdk/v1/reference`) as a release
 * has it. The tests and the client read the SDK's TypeScript source, through the
 * "@boilergames/source" condition; a release has only the compiled output (sdk/dist), and the server
 * reads the text from there to write its Build prompts. This proves that form resolves without the
 * source and holds the same text, before anything ships.
 *
 *   npm run check-built -w @boilergames/sdk
 */
import { fileRules, playtestSteps, SDK_TYPES } from "@boilergames/sdk/v1/reference";
import { SDK_TYPES as sourceTypes } from "../src/v1/reference-types.ts";

const where = import.meta.resolve("@boilergames/sdk/v1/reference");
const problems: string[] = [];
if (!where.endsWith("/sdk/dist/v1/reference.js")) problems.push(`it resolved to ${where}, not the built output`);
if (SDK_TYPES !== sourceTypes) problems.push("its SDK types text differs from the source's");
const limits = { maxSourceBytes: 123 * 1024, maxBundleBytes: 456 * 1024, loadMs: 7_000, runMs: 9_000, seeds: 11, uploadsPerHour: 13, uploadsPerDay: 17 };
const text = [...fileRules(limits), ...playtestSteps(limits)].join("\n");
for (const said of ["123 KB", "456 KB", "7 seconds", "9 seconds", "11 different random seeds"]) if (!text.includes(said)) problems.push(`its rules don't say ${said}`);
if (problems.length > 0) {
  console.error(`The SDK's built reference text is wrong: ${problems.join("; ")}`);
  process.exit(1);
}
console.log(`The SDK's built reference text: ${SDK_TYPES.split("\n").length} lines of types, and the rules`);

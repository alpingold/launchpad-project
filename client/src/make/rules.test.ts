import { expect, test } from "vitest";
import { fileRules, playtestSteps, promptText, type GameLimits } from "./rules.js";
import sdkTypes from "./sdk-v1.d.ts.txt?raw";

/** Numbers no real limit has, so finding each in the text shows it came from here and nowhere else. */
const ODD: GameLimits = { maxSourceBytes: 123 * 1024, maxBundleBytes: 456 * 1024, loadMs: 7_000, runMs: 9_000, seeds: 11, uploadsPerHour: 13, uploadsPerDay: 17 };

test("the rules and the Playtest's steps quote every limit they are given, and no other", () => {
  const text = [...fileRules(ODD), ...playtestSteps(ODD)].join("\n");
  for (const said of ["123 KB", "456 KB", "7 seconds", "9 seconds", "11 different random seeds", "13 times an hour", "17 times a day"]) expect(text).toContain(said);
  // Every number in the text is one of the given limits: the rules hold none of their own.
  const numbers = [...text.matchAll(/\b\d+\b/g)].map((match) => Number(match[0]));
  expect(numbers.every((n) => [123, 456, 7, 9, 11, 13, 17].includes(n))).toBe(true);
});

test("the prompt holds the rules, the SDK's types whole, and a place for the idea, but no example Game", () => {
  const prompt = promptText(ODD, sdkTypes);
  for (const rule of [...fileRules(ODD), ...playtestSteps(ODD)]) expect(prompt).toContain(rule);
  expect(prompt).toContain(sdkTypes.trim());
  expect(prompt).toContain("My idea for the Game:");
  // An example Game would be a defineGame({ call with a body; the rules only name its parts.
  expect(prompt).not.toMatch(/defineGame(<[^>]*>)?\(\{\s*about\s*:/);
});

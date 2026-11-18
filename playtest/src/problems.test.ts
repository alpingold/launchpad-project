// What a Playtest reports is always something the site will take: at most MAX_PROBLEMS problems, each
// at most MAX_PROBLEM_CHARS long. tsc can write a message pages long; an honest result must never be
// refused for it.
import { expect, test } from "vitest";
import { readResult } from "./client.js";
import { MAX_PROBLEM_CHARS, MAX_PROBLEMS } from "./limits.js";
import { capped, type Problem } from "./problems.js";

test("a long message is cut short, ending in an ellipsis, and the site takes it", () => {
  const [cut] = capped([{ stage: "types", line: 3, message: "x".repeat(MAX_PROBLEM_CHARS * 3) }]);
  expect(cut?.message).toHaveLength(MAX_PROBLEM_CHARS);
  expect(cut?.message.endsWith("…")).toBe(true);
  expect(cut?.line).toBe(3);
  expect(readResult(JSON.stringify({ ok: false, problems: [cut] })).ok).toBe(true);
  // Uncut, the site would refuse it.
  expect(readResult(JSON.stringify({ ok: false, problems: [{ stage: "types", message: "x".repeat(MAX_PROBLEM_CHARS + 1) }] })).ok).toBe(false);
});

test(`at most ${MAX_PROBLEMS} problems: the first ones, and one saying how many more`, () => {
  const many: Problem[] = Array.from({ length: 120 }, (_, i) => ({ stage: "play", message: `problem ${i + 1}` }));
  const kept = capped(many);
  expect(kept).toHaveLength(MAX_PROBLEMS);
  expect(kept[0]?.message).toBe("problem 1");
  expect(kept.at(-1)?.message).toBe("...and 71 more problems, not shown. Fix these first.");
  expect(readResult(JSON.stringify({ ok: false, problems: kept })).ok).toBe(true);
});

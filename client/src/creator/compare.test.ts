import { expect, test } from "vitest";
import { compareVersions, CONTEXT_LINES, type Comparison } from "./compare.js";

const lines = (comparison: Comparison) => (comparison.kind === "compared" ? comparison.lines : []);

test("an added line, a removed line and the unchanged ones, each numbered in its own file", async () => {
  const comparison = await compareVersions("one\ntwo\nthree\n", "one\nthree\nfour\n");
  expect(comparison).toEqual({
    kind: "compared",
    added: 1,
    removed: 1,
    lines: [
      { kind: "same", text: "one", oldNumber: 1, newNumber: 1 },
      { kind: "removed", text: "two", oldNumber: 2 },
      { kind: "same", text: "three", oldNumber: 3, newNumber: 2 },
      { kind: "added", text: "four", newNumber: 3 },
    ],
  });
});

test("a changed line is the old one removed and the new one added", async () => {
  expect(lines(await compareVersions("a\nb\nc\n", "a\nB\nc\n")).filter((line) => line.kind !== "same")).toEqual([
    { kind: "removed", text: "b", oldNumber: 2 },
    { kind: "added", text: "B", newNumber: 2 },
  ]);
});

test("identical files: nothing added or removed, every line folded as unchanged", async () => {
  const code = "const a = 1;\nconst b = 2;\n";
  expect(await compareVersions(code, code)).toEqual({ kind: "compared", added: 0, removed: 0, lines: [{ kind: "unchanged", count: 2 }] });
});

test("one empty file: every line of the other is added, or removed", async () => {
  expect(await compareVersions("", "x\ny\n")).toEqual({ kind: "compared", added: 2, removed: 0, lines: [{ kind: "added", text: "x", newNumber: 1 }, { kind: "added", text: "y", newNumber: 2 }] });
  expect(await compareVersions("x\ny\n", "")).toEqual({ kind: "compared", added: 0, removed: 2, lines: [{ kind: "removed", text: "x", oldNumber: 1 }, { kind: "removed", text: "y", oldNumber: 2 }] });
  expect(await compareVersions("", "")).toEqual({ kind: "compared", added: 0, removed: 0, lines: [] });
});

test("Windows line endings and a missing last newline are not changes", async () => {
  expect(await compareVersions("a\r\nb\r\n", "a\nb")).toEqual({ kind: "compared", added: 0, removed: 0, lines: [{ kind: "unchanged", count: 2 }] });
});

test(`unchanged lines far from a change are folded, keeping ${CONTEXT_LINES} on each side`, async () => {
  const before = Array.from({ length: 40 }, (_, n) => `line ${n + 1}`);
  const after = before.map((line) => (line === "line 20" ? "line twenty" : line));
  const shown = lines(await compareVersions(`${before.join("\n")}\n`, `${after.join("\n")}\n`));
  expect(shown[0]).toEqual({ kind: "unchanged", count: 19 - CONTEXT_LINES });
  expect(shown.filter((line) => line.kind === "same")).toHaveLength(2 * CONTEXT_LINES);
  expect(shown.at(-1)).toEqual({ kind: "unchanged", count: 20 - CONTEXT_LINES });
});

test("a comparison that takes too long is given up", async () => {
  // Two large files with nothing in common, and almost no time.
  const random = (seed: number) => Array.from({ length: 4_000 }, (_, n) => `${(n * seed) % 9973} ${seed}`).join("\n");
  expect(await compareVersions(random(7), random(13), 1)).toEqual({ kind: "tooLong" });
});

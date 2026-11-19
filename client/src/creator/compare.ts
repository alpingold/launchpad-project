/**
 * What changed between two Versions' code, line by line, worked out in the browser with the `diff`
 * package (the one dependency approved for milestone 2b). The server only hands over each source.
 *
 * Unchanged lines far from any change are folded into one "N unchanged lines" row, so a one-line
 * change in a long file is easy to find. A comparison that takes too long (two very different
 * large files) is given up, and the page offers the two downloads instead.
 */
import { diffLines, type ChangeObject } from "diff";

/** How long a comparison may take before it is given up. */
export const COMPARE_MS = 2_000;
/** How many unchanged lines are shown on each side of a change. */
export const CONTEXT_LINES = 3;

export type ComparedLine =
  | { readonly kind: "added"; readonly text: string; readonly newNumber: number }
  | { readonly kind: "removed"; readonly text: string; readonly oldNumber: number }
  | { readonly kind: "same"; readonly text: string; readonly oldNumber: number; readonly newNumber: number }
  /** Unchanged lines left out, far from any change. */
  | { readonly kind: "unchanged"; readonly count: number };

export type Comparison =
  | { readonly kind: "compared"; readonly lines: readonly ComparedLine[]; readonly added: number; readonly removed: number }
  | { readonly kind: "tooLong" };

/** A chunk's lines: "a\nb\n" and "a\nb" are both the lines a and b. */
function linesOf(value: string): string[] {
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Every line, numbered in the older file, the newer, or both. */
function everyLine(changes: readonly ChangeObject<string>[]): ComparedLine[] {
  const lines: ComparedLine[] = [];
  let oldNumber = 0;
  let newNumber = 0;
  for (const change of changes) {
    for (const text of linesOf(change.value)) {
      if (change.added) lines.push({ kind: "added", text, newNumber: ++newNumber });
      else if (change.removed) lines.push({ kind: "removed", text, oldNumber: ++oldNumber });
      else lines.push({ kind: "same", text, oldNumber: ++oldNumber, newNumber: ++newNumber });
    }
  }
  return lines;
}

/** Folds runs of unchanged lines, keeping CONTEXT_LINES next to each change. */
function folded(lines: readonly ComparedLine[]): ComparedLine[] {
  const nearChange = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.kind === "added" || line.kind === "removed") {
      for (let near = Math.max(0, index - CONTEXT_LINES); near <= Math.min(lines.length - 1, index + CONTEXT_LINES); near += 1) nearChange[near] = true;
    }
  });
  const shown: ComparedLine[] = [];
  let left = 0;
  lines.forEach((line, index) => {
    if (nearChange[index] === true) {
      if (left > 0) shown.push({ kind: "unchanged", count: left });
      left = 0;
      shown.push(line);
    } else {
      left += 1;
    }
  });
  if (left > 0) shown.push({ kind: "unchanged", count: left });
  return shown;
}

/**
 * Compares the older Version's code with the newer's. Line endings (Windows' \r\n or \n) and a
 * missing newline at the very end don't count as changes. Runs in small steps, so the page stays
 * responsive, and gives up after `timeoutMs`.
 */
export function compareVersions(older: string, newer: string, timeoutMs = COMPARE_MS): Promise<Comparison> {
  return new Promise((resolve) => {
    diffLines(older, newer, {
      stripTrailingCr: true,
      ignoreNewlineAtEof: true,
      timeout: timeoutMs,
      callback: (changes) => {
        if (changes === undefined) return resolve({ kind: "tooLong" });
        const lines = everyLine(changes);
        resolve({
          kind: "compared",
          lines: folded(lines),
          added: lines.filter((line) => line.kind === "added").length,
          removed: lines.filter((line) => line.kind === "removed").length,
        });
      },
    });
  });
}

// CHANGED LINES (plan §12e, K6): what's different between two versions of a game's code,
// so reviewing a change doesn't mean rereading the whole file.
//
// The classic approach, hand-written (no dependency): find the longest common subsequence
// (LCS) of the two files' lines. Lines in it are unchanged; every other old line was
// removed and every other new line was added. Then group the changes into "hunks" with a
// few unchanged lines around each, like `git diff` shows.
//
// The LCS table is old × new lines, so a 500-line file against a 500-line file is 250,000
// small numbers: fine. Past MAX_CELLS it gives up and says so instead of using lots of memory.

const MAX_CELLS = 4_000_000; // e.g. two 2000-line files
export const CONTEXT_LINES = 3;

/**
 * @typedef {{ type: 'same' | 'add' | 'del', text: string, oldLine: number | null, newLine: number | null }} DiffLine
 *   oldLine/newLine: 1-based line numbers in each file (null for the side the line isn't in)
 */

/**
 * Every line of both files, marked same / added / deleted, in order.
 * @param {string} oldText
 * @param {string} newText
 * @returns {DiffLine[] | null}  null if the files are too big to compare
 */
export function diffLines(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) return null;

  // lcs[i][j] = length of the LCS of a[i..] and b[j..], in one flat array.
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  // Walk the table from the start, taking the step that keeps the LCS longest.
  /** @type {DiffLine[]} */
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ type: 'same', text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (i < a.length && (j === b.length || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
      // Removals first, so a changed line reads "- old" then "+ new", like git diff.
      lines.push({ type: 'del', text: a[i], oldLine: i + 1, newLine: null });
      i++;
    } else {
      lines.push({ type: 'add', text: b[j], oldLine: null, newLine: j + 1 });
      j++;
    }
  }
  return lines;
}

/**
 * The changes grouped into hunks, each with up to CONTEXT_LINES unchanged lines around it.
 * @returns {{ added: number, removed: number, hunks: DiffLine[][] } | null}  null if too big
 */
export function changedLines(oldText, newText, context = CONTEXT_LINES) {
  const lines = diffLines(oldText, newText);
  if (!lines) return null;
  const changed = lines.map((l, index) => (l.type === 'same' ? -1 : index)).filter((index) => index !== -1);

  /** @type {DiffLine[][]} */
  const hunks = [];
  let start = -1;
  let end = -1;
  for (const index of changed) {
    if (start !== -1 && index - context <= end + 1) {
      end = Math.min(lines.length - 1, index + context); // close enough: grow the current hunk
    } else {
      if (start !== -1) hunks.push(lines.slice(start, end + 1));
      start = Math.max(0, index - context);
      end = Math.min(lines.length - 1, index + context);
    }
  }
  if (start !== -1) hunks.push(lines.slice(start, end + 1));

  return {
    added: lines.filter((l) => l.type === 'add').length,
    removed: lines.filter((l) => l.type === 'del').length,
    hunks,
  };
}

/** Lines of a file; a final newline doesn't make an extra empty line. */
function splitLines(text) {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

// EDIT MODE (plan §23): the model sends CHANGES to a game file, not the whole file again.
//
// Each change is a search/replace block: the exact lines to find, and what to put there.
//
//   <<<<<<< SEARCH
//   exact old lines
//   =======
//   new lines
//   >>>>>>> REPLACE
//
// Why this shape: the markers are git's merge-conflict markers, which a model has seen
// countless times and which never appear in working game code (a line that is only
// "=======" isn't valid JavaScript, HTML or CSS). Coding tools (e.g. Aider) use the same
// shape, so the model already knows how to write it. "FIND" is accepted in place of "SEARCH".
//
// Applying them is STRICT, because a wrong guess silently breaks a game: each SEARCH must
// match the file exactly once. If any edit fails, NOTHING is applied and every failure is
// reported in words the model can act on; the fix loop sends them back like any other
// problem the checks found. The result is always a whole file again, so everything after
// this (checkGame, saved attempts, the admin page's diff) works as it always did.

/** One edit: what to find and what to put in its place. */
/** @typedef {{ search: string, replace: string }} Edit */

/** @typedef {{ edit: number, message: string }} EditFailure  edit: 1-based, as the model counts */

const START = /^[ \t]*<{5,9}[ \t]*(?:SEARCH|FIND)[ \t]*$/;
const DIVIDER = /^[ \t]*={5,9}[ \t]*$/;
const END = /^[ \t]*>{5,9}[ \t]*REPLACE[ \t]*$/;

const withoutThinking = (reply) => String(reply ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');

/**
 * The edits in a reply, in order. Text outside the blocks (the list of changes, chatter,
 * code fences around the blocks) is ignored.
 * @param {string} reply
 * @returns {{ edits: Edit[], failures: EditFailure[] }}  failures: blocks that aren't finished
 */
export function parseEdits(reply) {
  const lines = withoutThinking(reply).replace(/\r\n/g, '\n').split('\n');
  const edits = [];
  const failures = [];
  let i = 0;
  while (i < lines.length) {
    if (!START.test(lines[i])) {
      i++;
      continue;
    }
    const n = edits.length + failures.length + 1;
    const divider = findLine(lines, DIVIDER, i + 1, START);
    const end = divider === -1 ? -1 : findLine(lines, END, divider + 1, START);
    if (end === -1) {
      failures.push({ edit: n, message: `edit ${n} isn't finished: each edit needs a <<<<<<< SEARCH line, a ======= line and a >>>>>>> REPLACE line, in that order.` });
      i++;
      continue;
    }
    edits.push({ search: lines.slice(i + 1, divider).join('\n'), replace: lines.slice(divider + 1, end).join('\n') });
    i = end + 1;
  }
  return { edits, failures };
}

/** The first line from `from` on that matches `want`, or -1 if `stop` (the next block) comes first. */
function findLine(lines, want, from, stop) {
  for (let j = from; j < lines.length; j++) {
    if (want.test(lines[j])) return j;
    if (stop.test(lines[j])) return -1;
  }
  return -1;
}

/** Whether a reply has any edit blocks at all (finished or not). */
export function hasEdits(reply) {
  return withoutThinking(reply).split('\n').some((line) => START.test(line.replace(/\r$/, '')));
}

/** A reply without its edit blocks (so the list of changes can be read without them). */
export function withoutEdits(reply) {
  const lines = String(reply ?? '').split('\n');
  const kept = [];
  let inside = false;
  for (const line of lines) {
    if (START.test(line.replace(/\r$/, ''))) inside = true;
    else if (inside && END.test(line.replace(/\r$/, ''))) inside = false;
    else if (!inside) kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Applies edits to a file, in order: each edit sees the file as the edits before it left it.
 * All or nothing: if any edit fails, the file is left alone and every failure is listed.
 *
 * Each SEARCH must be in the file exactly once. The only difference tolerated is
 * whitespace at the END of lines (models often drop or add trailing spaces, and they never
 * matter in a game): if the exact text isn't there, whole lines are compared without it.
 * Indentation, blank lines and everything else must match exactly.
 *
 * @param {string} source  the whole file
 * @param {Edit[]} edits
 * @returns {{ ok: true, source: string } | { ok: false, failures: EditFailure[] }}
 */
export function applyEdits(source, edits) {
  let text = String(source);
  /** Where earlier edits put their new text: [start, end) in `text` as it is now. */
  let changed = [];
  const failures = [];
  if (edits.length === 0) return { ok: false, failures: [{ edit: 0, message: 'The reply had no edits. Each change must be a <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE block.' }] };

  edits.forEach(({ search, replace }, index) => {
    const n = index + 1;
    if (search.trim() === '') {
      failures.push({ edit: n, message: `edit ${n}: the SEARCH part is empty. Copy at least one whole line from the file, so the edit knows where to go.` });
      return;
    }
    const matches = findAll(text, search);
    if (matches.length === 0) {
      failures.push({ edit: n, message: `edit ${n}: this text isn't in the file: ${quote(search)}. Copy the lines exactly as they are in the file now, with the same indentation.` });
      return;
    }
    if (matches.length > 1) {
      failures.push({ edit: n, message: `edit ${n}: this text matches ${matches.length} places in the file: ${quote(search)}. Include more lines around it, so it matches only one.` });
      return;
    }
    const [{ start, end }] = matches;
    const earlier = changed.find((c) => start < c.end && c.start < end);
    if (earlier) {
      failures.push({ edit: n, message: `edit ${n}: this text overlaps what edit ${earlier.edit} already changed. Put both changes in one edit.` });
      return;
    }
    text = text.slice(0, start) + replace + text.slice(end);
    // Shift the regions after this one by how much longer (or shorter) the text got.
    const shift = replace.length - (end - start);
    changed = changed.map((c) => (c.start >= end ? { ...c, start: c.start + shift, end: c.end + shift } : c));
    changed.push({ edit: n, start, end: start + replace.length });
  });
  return failures.length === 0 ? { ok: true, source: text } : { ok: false, failures };
}

/**
 * Every place `search` is in `text`, as [start, end) ranges. Exact matches first; if there
 * are none, whole lines compared without trailing whitespace (see applyEdits).
 * @returns {{ start: number, end: number }[]}
 */
function findAll(text, search) {
  const exact = [];
  for (let at = text.indexOf(search); at !== -1; at = text.indexOf(search, at + 1)) exact.push({ start: at, end: at + search.length });
  if (exact.length > 0) return exact;

  const want = search.split('\n').map((l) => l.trimEnd());
  if (want.at(-1) === '') want.pop(); // a SEARCH that ends with a newline
  const lines = text.split('\n');
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const found = [];
  for (let i = 0; i + want.length <= lines.length; i++) {
    if (want.every((w, k) => lines[i + k].trimEnd() === w)) {
      const last = i + want.length - 1;
      found.push({ start: starts[i], end: starts[last] + lines[last].length });
    }
  }
  return found;
}

/** The first line of a SEARCH, quoted, so the model knows which text we mean. */
function quote(search) {
  const first = search.split('\n').find((l) => l.trim() !== '') ?? '';
  const short = first.trim().length > 80 ? `${first.trim().slice(0, 80)}…` : first.trim();
  const more = search.trim().includes('\n') ? ' (the first line of it)' : '';
  return `"${short}"${more}`;
}

/**
 * A reply's edits, applied to `source`: the new whole file, or what went wrong (as lines
 * for the model: unfinished blocks first, else the edits that didn't fit).
 * @param {string} source
 * @param {string} reply
 * @returns {{ ok: true, source: string, edits: number } | { ok: false, failures: string[] }}
 */
export function applyReply(source, reply) {
  const parsed = parseEdits(reply);
  if (parsed.failures.length > 0) return { ok: false, failures: parsed.failures.map((f) => f.message) };
  const applied = applyEdits(source, parsed.edits);
  if (!applied.ok) return { ok: false, failures: applied.failures.map((f) => f.message) };
  return { ok: true, source: applied.source, edits: parsed.edits.length };
}

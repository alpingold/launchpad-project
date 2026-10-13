// LINT: quick text checks on a game's source code, before running it (plan §11c).
//
// This is NOT a security boundary. Clever code can hide anything from a text search;
// the OpenShell sandbox and a human review are what keep us safe. The lint exists to
// catch honest rule-breaking early (Math.random, Date.now, async, imports, ...) and to
// explain the rule, so a model (or a person) knows exactly what to fix.

/** Largest game source we accept. Real games are a few hundred lines. */
export const MAX_SOURCE_BYTES = 64 * 1024;

/**
 * Each rule: a pattern to look for in the code (with comments and string contents
 * removed), and the message explaining which contract rule it breaks.
 * `(?<![.\w$])` means "not right after a dot or a letter", so `ctx.setTimeout` and
 * `myDate` don't count, but a bare `setTimeout` or `Date` does.
 */
const RULES = [
  {
    pattern: /\bimport\b|\brequire\s*\(/g,
    message: 'imports are not allowed: a game gets everything it needs through ctx (rule 1)',
  },
  {
    pattern: /\bexport\b(?!\s+default\b)/g,
    message: 'only `export default { ... }` is allowed (the GameModule)',
  },
  {
    pattern: /(?<![.\w$])(?:eval|Function)\b/g,
    message: 'eval and Function are not allowed: games are plain code (rule 1)',
  },
  {
    pattern: /(?<![.\w$])(?:globalThis|global|process|Buffer|fetch|XMLHttpRequest|WebSocket)\b/g,
    message: 'games cannot reach the server, files, or the network; use only ctx (rule 1)',
  },
  {
    pattern: /\b(?:constructor|__proto__|prototype)\b/g,
    message: 'constructor / __proto__ / prototype tricks are not allowed; use plain objects and functions',
  },
  {
    pattern: /\b(?:async|await)\b|(?<![.\w$])(?:Promise|queueMicrotask)\b/g,
    message: 'no async code or Promises: everything must be synchronous; use ctx.setTimeout to wait (rule 7)',
  },
  {
    pattern: /(?<![.\w$])(?:setTimeout|setInterval|setImmediate|clearTimeout|clearInterval)\b/g,
    message: 'use ctx.setTimeout / ctx.clearTimeout, not the global timers (rule 4)',
  },
  {
    pattern: /\bMath\s*\.\s*random\b/g,
    message: 'use ctx.random() instead of Math.random(), so games are repeatable in tests (rule 4)',
  },
  {
    pattern: /(?<![.\w$])Date\b/g,
    message: 'use ctx.now() for the time instead of Date (rule 4)',
  },
];

/**
 * Checks a game's source code.
 * @param {string} source
 * @returns {string[]} problems, each starting with its line number (empty = passed)
 */
export function lintGameSource(source) {
  const bytes = Buffer.byteLength(source);
  if (bytes > MAX_SOURCE_BYTES) {
    return [`the game is ${Math.round(bytes / 1024)} KB; the limit is ${MAX_SOURCE_BYTES / 1024} KB`];
  }
  const code = stripCommentsAndStrings(source);
  const problems = [];
  for (const { pattern, message } of RULES) {
    // Report up to 3 places per rule: enough to find them, without a wall of repeats.
    for (const match of [...code.matchAll(pattern)].slice(0, 3)) {
      problems.push(`line ${lineOf(code, match.index)}: ${message} (found "${match[0].trim()}")`);
    }
  }
  return problems.sort((a, b) => lineNumber(a) - lineNumber(b));
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

const lineNumber = (problem) => Number(/^line (\d+)/.exec(problem)?.[1] ?? 0);

/**
 * Blanks out comments, the inside of strings, and the text parts of template literals
 * (but keeps the code inside `${...}`), replacing them with spaces so line numbers stay
 * the same. Then "Date" in a comment or in 'Update the date' doesn't count.
 *
 * Known limit: regular-expression literals (/.../) aren't recognized, so a quote inside
 * one can confuse it. Games rarely need regexes; the worst case is a wrong lint message.
 * @param {string} source
 */
export function stripCommentsAndStrings(source) {
  const out = [...source];
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  // A stack, because template literals can contain code that contains template literals.
  const stack = [{ type: 'code', braces: 0 }];
  let i = 0;
  while (i < source.length) {
    const top = stack.at(-1);
    const c = source[i];
    const next = source[i + 1];

    if (top.type === 'template') {
      if (c === '\\') {
        blank(i, i + 2);
        i += 2;
      } else if (c === '`') {
        stack.pop();
        i++;
      } else if (c === '$' && next === '{') {
        stack.push({ type: 'code', braces: 0 });
        i += 2;
      } else {
        blank(i, i + 1);
        i++;
      }
      continue;
    }

    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
    } else if (c === '`') {
      stack.push({ type: 'template' });
      i++;
    } else {
      if (c === '{') top.braces++;
      if (c === '}') {
        if (top.braces === 0 && stack.length > 1) {
          stack.pop(); // end of a ${...} inside a template literal
          i++;
          continue;
        }
        top.braces--;
      }
      i++;
    }
  }
  return out.join('');
}

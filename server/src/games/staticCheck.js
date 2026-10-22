// THE STATIC CHECK (plan §13i, F4): reads a frame game's file WITHOUT running it, and points
// at lines that use something a game must not, or can't, use.
//
// It is NOT the security wall: the iframe's sandbox and its Content-Security-Policy are
// (§13e), and they hold even against code written to hide from this check. What it's for:
// catching a model's habits early, with a line number and a reason the model (or you, in
// review) can act on. A CDN script, a Google Font, `fetch`, `localStorage` or `alert` fails
// in a game frame anyway; a link or `location.href = …` takes the frame somewhere else.
//
// How: the file is split into its parts (scripts, styles, the rest of the HTML), and the
// parts each rule shouldn't see are blanked out with spaces, keeping every line break, so a
// match's position is still its line in the file. Code rules never look inside strings or
// comments, so "Pick a location." or "// on top." can't trip them.
//
// It also compiles each script (without running it), to point at the line of a syntax error.

import vm from 'node:vm';

/**
 * @typedef {Object} Finding
 * @property {string} rule     a short name, e.g. "network"
 * @property {number} line     1-based line in the game file
 * @property {string} message  what's wrong and what to do instead
 * @property {string} code     that line, trimmed (at most 160 characters)
 */

// Which part of the file a rule reads:
//  code    JavaScript only, without strings or comments
//  text    JavaScript with its strings (markup built in code counts), without comments
//  markup  the HTML outside scripts and styles, without HTML comments
//  style   the insides of <style> elements, plus style="…" attributes
//  all     text + markup + style
const NOT_IDENT = '(?<![.\\w$])'; // so `myfetch(` or `obj.alert(` don't count

/** Rules that make the check fail: each one breaks the game or leaves its frame. */
const ERROR_RULES = [
  // The network: the CSP blocks all of it; the platform's only door is the party SDK.
  { rule: 'network', in: 'code', re: /\bfetch\s*\(/g, message: '`fetch` is blocked in a game. Games have no network: talk through `party` only.' },
  { rule: 'network', in: 'code', re: /\b(XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|WebTransport)\b/g, message: '`$1` is blocked in a game. Games have no network: talk through `party` only.' },
  { rule: 'network', in: 'code', re: /\bsendBeacon\b/g, message: '`sendBeacon` is blocked in a game. Games have no network.' },
  { rule: 'network', in: 'code', re: /\b(importScripts|serviceWorker)\b|\bnew\s+(Shared)?Worker\b/g, message: 'Workers are blocked in a game: keep all the code in the page.' },
  { rule: 'network', in: 'code', re: /(?<![.\w$])import\s*\(|(?<=(?:^|[;{}\n])[ \t]*)import\s+[\w{*'"]/g, message: '`import` loads code from elsewhere, which is blocked. Put everything in this one file.' },
  // Leaving the frame (plan §13e: the platform ends a game whose frame loads another page).
  { rule: 'navigation', in: 'code', re: new RegExp(`${NOT_IDENT}location\\s*(\\.|\\[|=(?!=))|\\b(window|document|self|globalThis)\\s*\\.\\s*location\\b`, 'g'), message: '`location` would load another page into the game\'s frame, which ends the game. Show screens by changing the page instead.' },
  { rule: 'navigation', in: 'code', re: /\bwindow\s*\.\s*open\s*\(|\bhistory\s*\.\s*(back|forward|go)\b/g, message: 'Opening or going to other pages isn\'t allowed in a game.' },
  { rule: 'navigation', in: 'all', re: /<a\b[^>]*\bhref\s*=/gi, message: 'A link would take the game\'s frame to another page, which ends the game. Use a <button>.' },
  { rule: 'navigation', in: 'all', re: /<form\b/gi, message: 'Forms submit to another page, which is blocked. Use buttons and inputs with JavaScript.' },
  { rule: 'navigation', in: 'all', re: /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/gi, message: 'A meta refresh would reload or leave the game.' },
  { rule: 'navigation', in: 'all', re: /<base\b/gi, message: '<base> isn\'t allowed in a game.' },
  // Code from strings.
  { rule: 'eval', in: 'code', re: new RegExp(`${NOT_IDENT}eval\\s*\\(|\\bnew\\s+Function\\s*\\(|${NOT_IDENT}Function\\s*\\(`, 'g'), message: 'Running code from text (`eval`, `Function`) is blocked in a game.' },
  { rule: 'eval', in: 'code', re: /\bset(Timeout|Interval)\s*\(\s*["'`]/g, message: '`set$1` with a string is code from text, which is blocked: pass a function.' },
  // The page around the game: only the party SDK talks to it.
  // A bare `top.` or `parent.` is the page only if the game hasn't made its own variable with
  // that name (`const top = …` was flagged by mistake in plan §13o's runs); `window.top` always is.
  { rule: 'page', in: 'code', re: new RegExp(`${NOT_IDENT}(parent|top|opener|frameElement)\\s*\\.|\\bwindow\\s*\\.\\s*(parent|top|opener|frameElement)\\b`, 'g'), unlessDeclared: 1, message: 'A game can\'t reach the page around it. Use `party` for everything.' },
  { rule: 'page', in: 'code', re: /\bpostMessage\s*\(/g, message: '`postMessage` is the party SDK\'s job: use `party.send`, `party.sendTo` or `party.setState`.' },
  // What a sandboxed frame doesn't have: these throw or do nothing.
  { rule: 'storage', in: 'code', re: /\b(localStorage|sessionStorage|indexedDB)\b|\bdocument\s*\.\s*cookie\b/g, message: 'Storage and cookies don\'t exist in a game frame (they throw). To survive a reload, use `party.save` and `restored`.' },
  { rule: 'dialog', in: 'code', re: new RegExp(`${NOT_IDENT}(alert|confirm|prompt)\\s*\\(|\\bwindow\\s*\\.\\s*(alert|confirm|prompt)\\b`, 'g'), message: 'Pop-up dialogs are blocked in a game frame. Show it on the page instead.' },
  { rule: 'dialog', in: 'code', re: /\bdocument\s*\.\s*write(ln)?\s*\(/g, message: '`document.write` replaces the page, including the party SDK. Change the page with the DOM instead.' },
  // Outside files: the CSP blocks them, so the game would load without them.
  { rule: 'outside', in: 'all', re: /<script\b[^>]*\bsrc\s*=/gi, message: 'Scripts from elsewhere are blocked. Put the code in this file.' },
  { rule: 'outside', in: 'all', re: /<link\b/gi, message: 'Stylesheets and fonts from elsewhere are blocked. Put styles in a <style> element and use system fonts.' },
  { rule: 'outside', in: 'all', re: /<(iframe|frame|object|embed)\b/gi, message: '<$1> isn\'t allowed in a game.' },
  { rule: 'outside', in: 'style', re: /@import\b|url\(\s*["']?(https?:)?\/\//gi, message: 'Styles, fonts and pictures from elsewhere are blocked. Use system fonts, or draw it.' },
  { rule: 'outside', in: 'markup', re: /\b(src|srcset|poster|data)\s*=\s*["']?\s*(https?:)?\/\//gi, message: 'Files from elsewhere are blocked. Draw it, or use `party.asset(id)` for our art.' },
  // A fake "log in again" box (plan §57): BoilerGames never asks for a password in a game.
  // In markup (type="password") and in code (.type = 'password', setAttribute('type', 'password'), { type: 'password' }).
  { rule: 'password', in: 'all', re: /\btype["'`]?\s*[=:,]\s*["'`]?password\b/gi, message: 'Password boxes aren\'t allowed in a game: BoilerGames never asks for a password in one.' },
];

/** Rules that only flag a line for review: probably a mistake, but not always. */
const WARNING_RULES = [
  { rule: 'address', in: 'text', re: /\bhttps?:\/\/[^\s"'`<>)]+/gi, message: 'An outside web address: anything loaded from it is blocked.' },
];

/**
 * @param {string} source  the game file
 * @returns {{ errors: Finding[], warnings: Finding[] }}
 */
export function staticCheck(source) {
  const views = splitViews(String(source));
  const lines = String(source).split('\n');
  const run = (rules) => {
    const found = [];
    const seen = new Set();
    for (const r of rules) {
      for (const m of views[r.in].matchAll(r.re)) {
        if (r.unlessDeclared && m[r.unlessDeclared] && declares(views.code, m[r.unlessDeclared])) continue;
        const line = lineAt(views.lineStarts, m.index);
        const key = `${r.rule}:${line}`;
        if (seen.has(key)) continue; // one finding per rule per line
        seen.add(key);
        const message = r.message.replace(/\$(\d)/g, (_, n) => m[Number(n)] ?? '');
        found.push({ rule: r.rule, line, message, code: lines[line - 1].trim().slice(0, 160) });
      }
    }
    return found.sort((a, b) => a.line - b.line);
  };

  const errors = [...syntaxErrors(views.scripts, views.lineStarts, lines), ...run(ERROR_RULES)];
  const warnings = run(WARNING_RULES);
  // The two calls every game needs (a missing one is the most common slip).
  if (!/\bparty\s*\.\s*ready\s*\(/.test(views.code)) {
    errors.push({ rule: 'sdk', line: 1, message: 'The game never calls `party.ready(…)`, so it never starts.', code: '' });
  }
  if (!/\bparty\s*\.\s*end\s*\(/.test(views.code)) {
    warnings.push({ rule: 'sdk', line: 1, message: 'The game never calls `party.end(…)`: only the host\'s Stop button can end it.', code: '' });
  }
  return { errors, warnings };
}

/** Does the code make its own variable, function or parameter with this name? */
function declares(code, name) {
  const n = `\\b${name}\\b`;
  return new RegExp(
    [
      `\\b(?:const|let|var|function|class)\\s+${n}`, // const top = …
      `\\b(?:const|let|var)\\s*[{[][^}\\]]*${n}[^}\\]]*[}\\]]\\s*=`, // const { top } = …
      `${n}\\s*=>`, // top => …
      `\\([^()]*${n}[^()]*\\)\\s*(?:=>|\\{)`, // (a, top) => … / function f(top) {
    ].join('|'),
  ).test(code);
}

/** How many syntax errors to find in one script (plan §52). */
export const MAX_SYNTAX_ERRORS = 8;

/**
 * Scripts that don't even parse, with the line of each mistake. (In the browser, a syntax
 * error only says "Unexpected token" with no line; the model couldn't tell where to look.)
 * The code is only compiled here, never run.
 *
 * A compiler stops at the first error, but a file often has several (the same slip repeated):
 * fixing one a round, the fix rounds ran out first (plan §52). So after each error its line is
 * blanked and the script compiled again, up to MAX_SYNTAX_ERRORS. A blanked line can cause an
 * error of its own further on (a brace it opened), so the later ones say how they were found.
 */
function syntaxErrors(scripts, lineStarts, lines) {
  const found = [];
  for (const { start, text } of scripts) {
    const scriptLines = text.split('\n');
    const errors = [];
    while (errors.length < MAX_SYNTAX_ERRORS) {
      let err;
      try {
        new vm.Script(scriptLines.join('\n'), { filename: 'game-script' });
        break;
      } catch (e) {
        if (!(e instanceof SyntaxError)) break;
        err = e;
      }
      const at = /^game-script:(\d+)/.exec(err.stack ?? '');
      const scriptLine = at ? Number(at[1]) : 1;
      // No progress (the same line again, or one already blank): stop.
      if (errors.some((e) => e.scriptLine === scriptLine) || !scriptLines[scriptLine - 1]?.trim()) {
        if (errors.length === 0) errors.push({ scriptLine, message: err.message });
        break;
      }
      // A bracket error right around a blanked line is most likely that blanking's doing (the
      // line opened something): the rest would be noise, so stop.
      if (errors.some((e) => scriptLine >= e.scriptLine - 2 && scriptLine <= e.scriptLine + 3) && /missing \) |Unexpected token '?[)}\]]'?|Unexpected end of input/.test(err.message)) break;
      errors.push({ scriptLine, message: err.message });
      scriptLines[scriptLine - 1] = '';
    }
    errors.forEach((e, i) => {
      const line = lineAt(lineStarts, start) + e.scriptLine - 1;
      const message =
        i === 0
          ? `This script doesn't parse: ${e.message}. Fix the syntax on this line (or just before it).${errors.length > 1 ? ` It has ${errors.length === MAX_SYNTAX_ERRORS ? 'at least ' : ''}${errors.length} syntax errors (listed next): fix every one, and look for the same mistake elsewhere in the file.` : ''}`
          : `Another syntax error (found by skipping the lines above): ${e.message}. Fix the syntax on this line (or just before it).`;
      found.push({ rule: 'syntax', line, message, code: lines[line - 1]?.trim().slice(0, 160) ?? '' });
    });
  }
  return found;
}

function lineAt(lineStarts, index) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Spaces instead of everything but line breaks, so positions and lines stay the same. */
const blank = (text) => text.replace(/[^\n]/g, ' ');

/**
 * The file's views (see the top of this file), each the same length as the file.
 * @param {string} source
 */
export function splitViews(source) {
  const len = source.length;
  // Arrays of UTF-16 units (not code points), so positions match the source exactly.
  const code = blank(source).split('');
  const text = blank(source).split('');
  const markup = source.split('');
  const style = blank(source).split('');
  /** Puts `piece` (which starts at `at` in the source) into a view. */
  const put = (target, at, piece) => {
    for (let i = 0; i < piece.length; i++) target[at + i] = piece[i];
  };
  const clear = (target, from, to) => {
    for (let i = from; i < to; i++) if (target[i] !== '\n') target[i] = ' ';
  };

  /** The JavaScript in <script> elements, with where each starts (for the syntax check). */
  const scripts = [];

  // HTML comments are nobody's business.
  for (const m of source.matchAll(/<!--[\s\S]*?(-->|$)/g)) clear(markup, m.index, m.index + m[0].length);

  // <script> and <style> contents leave the markup view and go to their own.
  const element = /<(script|style)\b([^>]*)>([\s\S]*?)(<\/\1\s*>|$)/gi;
  for (const m of source.matchAll(element)) {
    const start = m.index + m[0].indexOf('>') + 1;
    const end = start + m[3].length;
    if (isInsideComment(source, m.index)) continue;
    clear(markup, start, end);
    if (m[1].toLowerCase() === 'style') {
      put(style, start, m[3]);
    } else if (isJavaScript(m[2])) {
      const js = scanJs(m[3]);
      put(code, start, js.code);
      put(text, start, js.text);
      if (!/\btype\s*=\s*["']?module/i.test(m[2])) scripts.push({ start, text: m[3] });
    }
  }
  // Inline event handlers (onclick="…") are code too; style="…" attributes are styles.
  const markupText = markup.join('');
  for (const m of markupText.matchAll(/\s(on[a-z]+|style)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const valueStart = m.index + m[0].indexOf(m[2]) + 1;
    const value = m[3] ?? m[4];
    if (m[1].toLowerCase() === 'style') put(style, valueStart, value);
    else {
      const js = scanJs(value);
      put(code, valueStart, js.code);
      put(text, valueStart, js.text);
    }
  }

  const views = { code: code.join(''), text: text.join(''), markup: markupText, style: style.join(''), scripts };
  views.all = mergeViews([views.text, views.markup, views.style], len);
  views.lineStarts = [0];
  for (let i = 0; i < len; i++) if (source[i] === '\n') views.lineStarts.push(i + 1);
  return views;
}

function isInsideComment(source, index) {
  const open = source.lastIndexOf('<!--', index);
  return open !== -1 && source.lastIndexOf('-->', index) < open;
}

/** A <script> with no type, or a JavaScript one (not the game-info JSON). */
function isJavaScript(attributes) {
  const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1]?.toLowerCase();
  return !type || type === 'module' || type.includes('javascript') || type.includes('ecmascript');
}

/** Overlays views that never overlap (each keeps only its own part): spaces lose. */
function mergeViews(list, len) {
  let out = '';
  for (let i = 0; i < len; i++) {
    let ch = list[0][i];
    for (const v of list) if (v[i] !== ' ' && v[i] !== '\n') ch = v[i];
    out += ch;
  }
  return out;
}

/**
 * Splits JavaScript into its code (strings and comments blanked; the quotes stay, so
 * `setTimeout("` is still visible) and its text (only comments blanked). A small scanner,
 * not a parser: good enough for real code, and it never throws.
 * @param {string} src
 * @returns {{ code: string, text: string }}
 */
export function scanJs(src) {
  const code = src.split('');
  const text = src.split('');
  const hide = (arr, i) => {
    if (arr[i] !== '\n') arr[i] = ' ';
  };
  // A stack of open template literals: each entry counts the `{` open inside its ${ … }.
  const templates = [];
  let lastSignificant = ''; // the last code character that wasn't a space, to spot regexes
  let lastWord = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') {
        hide(code, i);
        hide(text, i);
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) {
        hide(code, i);
        hide(text, i);
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(src, i, ch, code);
      lastSignificant = ch;
      lastWord = '';
      continue;
    }
    if (ch === '`' || (ch === '}' && templates.length && templates.at(-1) === 0)) {
      if (ch === '}') templates.pop();
      // Template text, up to the closing ` or the next ${.
      i++;
      while (i < src.length && src[i] !== '`' && !(src[i] === '$' && src[i + 1] === '{')) {
        if (src[i] === '\\') hide(code, i++);
        hide(code, i++);
      }
      if (src[i] === '$') {
        templates.push(0);
        i += 2;
      } else i++;
      lastSignificant = '`';
      lastWord = '';
      continue;
    }
    if (ch === '/' && regexCanStart(lastSignificant, lastWord)) {
      i = skipRegex(src, i, code);
      lastSignificant = '/';
      lastWord = '';
      continue;
    }
    if (templates.length) {
      if (ch === '{') templates[templates.length - 1]++;
      else if (ch === '}') templates[templates.length - 1]--;
    }
    if (/[\w$]/.test(ch)) {
      let j = i;
      while (j < src.length && /[\w$]/.test(src[j])) j++;
      lastWord = src.slice(i, j);
      lastSignificant = 'a';
      i = j;
      continue;
    }
    if (!/\s/.test(ch)) {
      lastSignificant = ch;
      lastWord = '';
    }
    i++;
  }
  return { code: code.join(''), text: text.join('') };
}

function skipString(src, i, quote, code) {
  i++;
  while (i < src.length && src[i] !== quote && src[i] !== '\n') {
    if (src[i] === '\\') hideAt(code, i++);
    hideAt(code, i++);
  }
  return i + 1;
}

function skipRegex(src, i, code) {
  i++;
  let inClass = false;
  while (i < src.length && src[i] !== '\n') {
    const ch = src[i];
    if (ch === '\\') {
      hideAt(code, i++);
    } else if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) break;
    hideAt(code, i++);
  }
  return i + 1;
}

function hideAt(arr, i) {
  if (i < arr.length && arr[i] !== '\n') arr[i] = ' ';
}

const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

/** Is a `/` here the start of a regex (rather than division)? */
function regexCanStart(lastSignificant, lastWord) {
  if (lastWord) return REGEX_AFTER_WORDS.has(lastWord);
  return lastSignificant === '' || '(,=:[!&|?{};+-*%<>~^'.includes(lastSignificant);
}

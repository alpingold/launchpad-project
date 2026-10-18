// Pulling what we need out of a model's reply (plan §13i, F5): a game file from the build
// step, a design from the design step, and the list of changes from a change request.
//
// Models wrap code in ``` fences and sometimes add explanations around it, or (some
// "thinking" models) a <think>...</think> section first. Thinking is always removed first.

const withoutThinking = (reply) => String(reply ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');
const GAME_INFO = /<script\b[^>]*id=["']game-info["']/i;

/**
 * The game file in a reply: the longest fenced block that has the game-info block (```html,
 * or any other fence), or, with no fences, the reply itself from the game-info block on.
 * @param {string} reply
 * @returns {string | null} the file, or null if there's none
 */
export function extractGameFile(reply) {
  const text = withoutThinking(reply);
  const blocks = [...text.matchAll(/```[ \t]*[\w-]*[ \t]*\r?\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => GAME_INFO.test(b));
  if (blocks.length > 0) return blocks.sort((a, b) => b.length - a.length)[0].trim() + '\n';
  const start = text.search(GAME_INFO);
  return start === -1 ? null : text.slice(start).trim() + '\n';
}

/** The longest design we keep: room above DESIGN.md's "at most about 1,800 words" (≈ 12,000 characters). */
export const MAX_DESIGN_LENGTH = 20_000;

/**
 * The design (or change plan) in a reply: Markdown from its first `# ` heading on. Models
 * sometimes put it in a ```markdown fence; that's unwrapped. Chatter before the heading is
 * dropped.
 * @param {string} reply
 * @returns {string | null}
 */
export function extractDesign(reply) {
  let text = withoutThinking(reply).trim();
  const fenced = /```[ \t]*(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)```/.exec(text);
  if (fenced && /^#\s/m.test(fenced[1])) text = fenced[1];
  const start = text.search(/^#\s+\S/m);
  if (start === -1) return null;
  return text.slice(start).trim().slice(0, MAX_DESIGN_LENGTH) + '\n';
}

/**
 * The design (or change plan) in a reply held to headingsFormat (prompt.js): JSON with a title
 * and one field per heading, joined into the same Markdown as a written design. A heading
 * with no text is left out, so missingHeadings still notices it. A reply that isn't that JSON
 * (a server that ignored the format) is read as Markdown instead.
 * @param {string} reply
 * @param {string[]} headings
 * @param {string} [titlePrefix]  "Change: " for a change plan
 * @returns {string | null}
 */
export function extractHeadings(reply, headings, titlePrefix = '') {
  let fields;
  try {
    fields = JSON.parse(withoutThinking(reply).trim());
  } catch {
    return extractDesign(reply);
  }
  if (!fields || typeof fields !== 'object' || typeof fields.title !== 'string') return extractDesign(reply);
  const title = fields.title.trim().replace(/^#+\s*/, '');
  const prefixed = title.toLowerCase().startsWith(titlePrefix.toLowerCase()) ? title : `${titlePrefix}${title}`;
  const sections = headings.flatMap((h) => {
    // A model may repeat the heading at the top of its text: drop it.
    const text = typeof fields[h] === 'string' ? fields[h].trim().replace(/^#+\s*(.+)\r?\n/, (line, name) => (name.trim().toLowerCase() === h.toLowerCase() ? '' : line)).trim() : '';
    return text ? [`## ${h}\n${text}`] : [];
  });
  return [`# ${prefixed}`, ...sections].join('\n\n').slice(0, MAX_DESIGN_LENGTH) + '\n';
}

/**
 * The headings from `required` that a design is missing (compared without case).
 * @param {string} design
 * @param {string[]} required  e.g. ['Genre and feel', 'Players', ...]
 */
export function missingHeadings(design, required) {
  const present = new Set([...String(design).matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1].toLowerCase()));
  return required.filter((h) => !present.has(h.toLowerCase()));
}

/** At most this many change lines are kept, each at most this long. */
const MAX_CHANGE_LINES = 8;
const MAX_CHANGE_LENGTH = 200;

/**
 * Pulls the list of changes out of a reply to a change request (plan §12e, K6). The model
 * is asked to start with a `CHANGES:` line followed by one `- ` line per change, before
 * the code. Thinking and code blocks are ignored.
 * @param {string} reply
 * @returns {string | null}  "- first change\n- second change", or null if there's no list
 */
export function extractChangelog(reply) {
  const text = String(reply ?? '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```[\s\S]*?```/g, '');
  const after = /^\W*CHANGES\W*:?\W*$/im.exec(text);
  if (!after) return null;
  const lines = [];
  for (const raw of text.slice(after.index + after[0].length).split('\n')) {
    const line = raw.trim();
    if (/^[-*•]\s+\S/.test(line)) lines.push(`- ${line.replace(/^[-*•]\s+/, '').slice(0, MAX_CHANGE_LENGTH)}`);
    else if (line && lines.length) break; // the list is over
  }
  return lines.length ? lines.slice(0, MAX_CHANGE_LINES).join('\n') : null;
}

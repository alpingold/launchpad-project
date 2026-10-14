/**
 * Pulls the game's code out of a model's reply.
 *
 * Models wrap code in ```js fences and sometimes add explanations around it, or (some
 * "thinking" models) a <think>...</think> section first. We take the longest fenced code
 * block after removing any thinking. If there's no fence at all but the reply looks like
 * a module, we take the whole reply.
 * @param {string} reply
 * @returns {string | null} the code, or null if there's none
 */
export function extractCode(reply) {
  const text = String(reply ?? '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const blocks = [...text.matchAll(/```[ \t]*(?:js|javascript|mjs)?[ \t]*\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length > 0) return blocks.sort((a, b) => b.length - a.length)[0].trim() + '\n';
  return /export\s+default/.test(text) ? text.trim() + '\n' : null;
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

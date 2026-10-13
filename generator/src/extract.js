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

import { runJob } from '../../../generator/src/run.js';
import { DESIGN_HEADINGS, PLAN_HEADINGS } from '../../../generator/src/prompt.js';
import { frameGameReport } from '../../src/games/frameGame.js';
import { TAP_SOURCE } from './frameGames.js';

// The real generator in place of the sandbox, for the generation module's tests: its "run one
// job" entry point (generator/src/run.js) runs in-process, with a fake model and a fake checker.
// The job goes through JSON first, as it does on its way into a real sandbox (sandbox.js), so a
// job the generator would refuse fails the test the way it would fail a real run.

/** A design (or plan) with every heading the generator asks for, so it's taken in one try. */
export function withHeadings(title, headings = DESIGN_HEADINGS, text = (h) => `What the ${h.toLowerCase()} are.`) {
  return `# ${title}\n\n${headings.map((h) => `## ${h}\n${text(h)}`).join('\n\n')}\n`;
}

/**
 * A fake model that answers by what it's asked for (the response format's name): a design, a
 * change plan, a code review's bugs; anything else is asked for code, and gets the game file
 * (a list: one per ask for code, in order, the last one from then on).
 * @param {{ design?: string, plan?: string, game?: string | string[], bugs?: object[] }} [replies]
 */
export function fakeModel({ design = withHeadings('A Game'), plan = withHeadings('Change: A change', PLAN_HEADINGS), game = TAP_SOURCE, bugs = [] } = {}) {
  const games = [game].flat();
  return async (messages, opts) => {
    const kind = opts?.responseFormat?.json_schema?.name ?? 'code';
    const file = () => (games.length > 1 ? games.shift() : games[0]);
    const content = { design, plan, critical_bugs: JSON.stringify({ bugs }) }[kind] ?? `\`\`\`html\n${file()}\`\`\``;
    return { content, thinking: '', finishReason: 'stop', toolCalls: '', seconds: 1, usage: null };
  };
}

/**
 * A model that adds each ask to `asked` before `chatFn` answers it: its kind (the response
 * format's name, or 'code'), the model it was asked of, and its last message (what reached the AI).
 * @param {(messages: object[], opts?: object) => Promise<object>} chatFn
 * @param {{ kind: string, model?: string, text: string }[]} asked
 */
function recording(chatFn, asked) {
  return (messages, opts) => {
    const kind = opts?.responseFormat?.json_schema?.name ?? 'code';
    asked.push({ kind, model: opts?.model, text: String(messages.at(-1)?.content ?? '') });
    return chatFn(messages, opts);
  };
}

/** A fake checker: the server's own report (the game info and the static check), with no playtest. */
export const staticOnly = async (source) => frameGameReport(source);

/**
 * A runGenerator for GenerationService that runs the real generator, and what the model was
 * asked (`asked`, each ask's last message, by response format: 'design', 'plan', 'code', ...).
 * @param {{ model?: Parameters<typeof fakeModel>[0] | ReturnType<typeof fakeModel>, check?: typeof staticOnly }} [opts]
 *   model: fakeModel's replies, or a fake model of a test's own (one that reads what it's asked);
 *   either way `asked` records every ask
 */
export function realGenerator({ model, check = staticOnly } = {}) {
  const asked = [];
  const chatFn = recording(typeof model === 'function' ? model : fakeModel(model), asked);
  const runGenerator = (job, { onStep } = {}) => runJob(JSON.parse(JSON.stringify(job)), { chatFn, check, onStep });
  return { runGenerator, asked };
}

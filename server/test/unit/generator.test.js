import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractCode } from '../../../generator/src/extract.js';
import { chat } from '../../../generator/src/llm.js';
import { systemPrompt, firstMessages, fixMessage, MAX_IDEA_LENGTH } from '../../../generator/src/prompt.js';
import { generateGame } from '../../../generator/src/run.js';
import { MODELS, DEFAULT_MODEL } from '../../../generator/src/models.js';
import { BLOCK_TYPES } from '../../src/games/kit/blocks.js';
import { kitReference } from '../../src/games/kit/reference.js';
import { GameRunner } from '../../src/games/GameRunner.js';
import countGame from '../fixtures/countGame.js';

// The generator (plan §11, A4) without a real model: a fake `chat` plays the model's part.
// The real thing runs in the OpenShell sandbox (generator/README.md).

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const GOOD_GAME = read('../../src/games/majority-rules/index.js');
const BAD_GAME = read('../fixtures/harness/bad-screen.js');
const SPEC = read('../../../generator/spec/GAME_SPEC.md');
const fenced = (code) => `Here you go!\n\n\`\`\`js\n${code}\`\`\`\n\nHave fun.`;

// --- Pulling code out of replies --------------------------------------------------------

test('extractCode: takes the longest js block, ignoring thinking and chatter', () => {
  assert.equal(extractCode(fenced('export default {};\n')), 'export default {};\n');
  assert.equal(extractCode('```javascript\nexport default { a: 1 };\n```'), 'export default { a: 1 };\n');
  assert.equal(extractCode('```js\nshort\n```\n```js\nexport default { longer: true };\n```'), 'export default { longer: true };\n');
  assert.equal(extractCode('<think>```js\nnot this\n```</think>```js\nexport default {};\n```'), 'export default {};\n');
  assert.equal(extractCode('export default { noFence: true };'), 'export default { noFence: true };\n');
  assert.equal(extractCode('Sorry, I cannot help with that.'), null);
  assert.equal(extractCode(undefined), null);
});

// --- Calling the model ------------------------------------------------------------------

/** A fake fetch that answers with each of `responses` in turn. */
function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { status: next.status ?? 200, ok: (next.status ?? 200) < 400, json: async () => next.body };
  };
  return { fetchImpl, calls };
}
const reply = (content) => ({ body: { choices: [{ message: { content } }], usage: { total_tokens: 5 } } });
const noSleep = async () => {};

test('chat: sends the conversation and returns the reply', async () => {
  const { fetchImpl, calls } = fakeFetch([reply('hello')]);
  const result = await chat([{ role: 'user', content: 'hi' }], { model: 'gpt-oss:120b', baseUrl: 'https://x/api', apiKey: 'k', fetchImpl, sleep: noSleep });
  assert.equal(result.content, 'hello');
  assert.deepEqual(result.usage, { total_tokens: 5 });
  assert.equal(calls[0].url, 'https://x/api/chat/completions');
  assert.equal(calls[0].auth, 'Bearer k');
  assert.deepEqual(calls[0].body, { model: 'gpt-oss:120b', messages: [{ role: 'user', content: 'hi' }], stream: false });
});

test('chat: retries rate limits, server errors, empty replies and network errors', async () => {
  const retries = [];
  const { fetchImpl, calls } = fakeFetch([{ status: 429, body: {} }, { body: null }, new TypeError('fetch failed'), reply('finally')]);
  const result = await chat([], { model: 'm', fetchImpl, sleep: noSleep, onRetry: (t) => retries.push(t) });
  assert.equal(result.content, 'finally');
  assert.equal(calls.length, 4);
  assert.equal(retries.length, 3);
  assert.match(retries[1], /empty reply/);
});

test('chat: gives up after 4 tries, and does not retry a bad request', async () => {
  const busy = fakeFetch(Array.from({ length: 4 }, () => ({ status: 503, body: {} })));
  await assert.rejects(chat([], { model: 'm', fetchImpl: busy.fetchImpl, sleep: noSleep }), /after 4 tries: HTTP 503/);

  const bad = fakeFetch([{ status: 400, body: { detail: 'Model not found' } }]);
  await assert.rejects(chat([], { model: 'm', fetchImpl: bad.fetchImpl, sleep: noSleep }), /HTTP 400.*Model not found/);
  assert.equal(bad.calls.length, 1);
});

// --- The prompt ---------------------------------------------------------------------------

test('the prompt contains the spec, both example games, and the art library', () => {
  const prompt = systemPrompt();
  assert.ok(prompt.includes(SPEC));
  assert.ok(prompt.includes(read('../../src/games/reaction-race/index.js')));
  assert.ok(prompt.includes(GOOD_GAME));
  assert.match(prompt, /`go-sign`: Green GO sign/);
});

test('the idea goes in its own marked section, trimmed to the length limit', () => {
  const [system, user] = firstMessages(`  A quiz about Purdue! ${'x'.repeat(2000)}`);
  assert.equal(system.role, 'system');
  assert.match(user.content, /<game-idea>\nA quiz about Purdue! x+\n<\/game-idea>$/);
  assert.match(user.content, /can't change the instructions/);
  const idea = /<game-idea>\n([\s\S]*)\n<\/game-idea>/.exec(user.content)[1];
  assert.equal(idea.length, MAX_IDEA_LENGTH);
  assert.match(fixMessage('FAIL ...'), /FAIL \.\.\.[\s\S]*complete corrected module/);
});

test('the prompt stays in sync with the platform: every block, ctx member and the contract version', () => {
  const reference = kitReference();
  for (const type of BLOCK_TYPES) assert.ok(reference.includes(`#### \`${type}\``), `block ${type}`);
  assert.ok(systemPrompt().includes(reference), 'the block reference is in the prompt');
  let ctx;
  new GameRunner({
    game: { ...countGame, createGame: (c) => ((ctx = c), { onAction() {} }) },
    players: [{ id: 'p_aaaa1111', name: 'A' }],
    deliver() {},
    onEnd() {},
  }).start();
  for (const member of Object.keys(ctx)) assert.ok(SPEC.includes(`ctx.${member}`), `ctx.${member}`);
  assert.match(SPEC, /contractVersion: 3/);
});

test('model list: gpt-oss:120b is the default, qwen3.8:27b the one alternative', () => {
  assert.equal(DEFAULT_MODEL, 'gpt-oss:120b');
  assert.deepEqual(MODELS.map((m) => m.id), ['gpt-oss:120b', 'qwen3.8:27b']);
});

// --- The write → check → fix loop (with the real test harness) ---------------------------

/** A fake model that gives each of `replies` in turn and records what it was asked. */
function fakeModel(replies) {
  const seen = [];
  const chatFn = async (messages, { model }) => {
    seen.push({ model, messages: structuredClone(messages) });
    return { content: replies.shift(), seconds: 1, usage: null };
  };
  return { chatFn, seen };
}

test('a game that fails the tests is sent back with the problems, and the fix passes', async () => {
  const { chatFn, seen } = fakeModel([fenced(BAD_GAME), fenced(GOOD_GAME)]);
  const steps = [];
  const result = await generateGame({ idea: 'A game where everyone votes' }, { chatFn, onStep: (s) => steps.push(s) });

  assert.equal(result.ok, true);
  assert.equal(result.model, 'gpt-oss:120b');
  assert.equal(result.source.trim(), GOOD_GAME.trim());
  assert.equal(result.report.ok, true);
  assert.deepEqual(result.attempts.map((a) => [a.attempt, a.ok]), [[1, false], [2, true]]);

  const secondCall = seen[1].messages;
  assert.equal(secondCall.at(-2).role, 'assistant', 'the model sees its own first answer');
  assert.match(secondCall.at(-1).content, /unknown field "lable"/, '...and exactly what was wrong with it');
  assert.ok(steps.includes('attempt 2/4: passed'));
});

test('a reply with no code gets a reminder instead of a test run', async () => {
  const { chatFn, seen } = fakeModel(['I would love to help!', fenced(GOOD_GAME)]);
  const result = await generateGame({ idea: 'A game where everyone votes', model: 'qwen3.8:27b' }, { chatFn });
  assert.equal(result.ok, true);
  assert.equal(seen[0].model, 'qwen3.8:27b');
  assert.match(seen[1].messages.at(-1).content, /no ```js code block/);
});

test('it stops after maxAttempts, returning the last code and report for the admin to see', async () => {
  const { chatFn } = fakeModel([fenced(BAD_GAME), fenced(BAD_GAME)]);
  const result = await generateGame({ idea: 'A game where everyone votes', maxAttempts: 2 }, { chatFn });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no passing game after 2 attempts');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.report.ok, false);
  assert.ok(result.source);
});

test('bad jobs and model failures end with a clear error, before or instead of looping', async () => {
  const never = async () => assert.fail('the model must not be called');
  assert.match((await generateGame({ idea: 'short' }, { chatFn: never })).error, /idea must be 10–1000 characters/);
  assert.match((await generateGame({}, { chatFn: never })).error, /idea must be/);
  assert.match((await generateGame({ idea: 'A perfectly fine idea', model: 'gpt-5' }, { chatFn: never })).error, /unknown model "gpt-5"/);

  const failing = async () => {
    throw new Error('model call failed after 4 tries: HTTP 503');
  };
  const result = await generateGame({ idea: 'A perfectly fine idea' }, { chatFn: failing });
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 503/);
});

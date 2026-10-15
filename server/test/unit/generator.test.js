import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCode, extractChangelog } from '../../../generator/src/extract.js';
import { chat } from '../../../generator/src/llm.js';
import { MODELS, DEFAULT_MODEL } from '../../../generator/src/models.js';

// The generator's building blocks that don't depend on what kind of game it writes: pulling
// code out of replies, calling the model, the model list. The prompt and the write → check
// → fix loop were for block games; on the iframe-games branch they're rewritten for frame
// games in F5 (plan §13i).

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

test('extractChangelog: the "- " lines after CHANGES:, ignoring thinking, code and later lists', () => {
  const reply = `<think>CHANGES:\n- not this</think>Sure!\n\n**CHANGES:**\n\n- Rounds are 30 s now\n* A scoreboard after each round\nHere you go:\n\`\`\`js\n- not code\n\`\`\`\nNotes:\n- not this either`;
  assert.equal(extractChangelog(reply), '- Rounds are 30 s now\n- A scoreboard after each round');
  assert.equal(extractChangelog('No list, just code.'), null);
  assert.equal(extractChangelog(`CHANGES:\n${'- x\n'.repeat(20)}`).split('\n').length, 8, 'at most 8 lines');
  assert.equal(extractChangelog(`CHANGES:\n- ${'y'.repeat(500)}`).length, 2 + 200, 'each at most 200 characters');
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
  const result = await chat([{ role: 'user', content: 'hi' }], { model: 'qwen3.8:27b', baseUrl: 'https://x/api', apiKey: 'k', fetchImpl, sleep: noSleep });
  assert.equal(result.content, 'hello');
  assert.deepEqual(result.usage, { total_tokens: 5 });
  assert.equal(calls[0].url, 'https://x/api/chat/completions');
  assert.equal(calls[0].auth, 'Bearer k');
  assert.deepEqual(calls[0].body, { model: 'qwen3.8:27b', messages: [{ role: 'user', content: 'hi' }], stream: false });
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

// --- Models ------------------------------------------------------------------------------

test('model list: qwen3.8:27b only (gpt-oss:120b was dropped)', () => {
  assert.equal(DEFAULT_MODEL, 'qwen3.8:27b');
  assert.deepEqual(MODELS.map((m) => m.id), ['qwen3.8:27b']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractGameFile, extractDesign, extractHeadings, missingHeadings, extractChangelog } from '../../../generator/src/extract.js';
import { chat, OutOfRoomError } from '../../../generator/src/llm.js';
import { MODELS, DEFAULT_MODEL } from '../../../generator/src/models.js';
import {
  designMessages,
  planMessages,
  buildMessages,
  changeBuildMessages,
  headingsFormat,
  DESIGN_HEADINGS,
  PLAN_HEADINGS,
} from '../../../generator/src/prompt.js';
import { runJob, formatReport } from '../../../generator/src/run.js';

// The generator (plan §13i, F5): pulling designs and game files out of replies, the
// prompts for both steps, calling the model, and the design and build jobs, run here with
// a fake model and a fake checker (the real checker's own tests are in generator/test/).

const GAME = readFileSync(new URL('../fixtures/tap-test.html', import.meta.url), 'utf8');
const DESIGN = readFileSync(new URL('../../../generator/spec/designs/bumper-blobs.md', import.meta.url), 'utf8');
const fenced = (lang, text) => `Here you go!\n\n\`\`\`${lang}\n${text}\`\`\`\n\nHave fun.`;

// --- Pulling things out of replies --------------------------------------------------------

test('extractGameFile: the longest fenced block with the game info, ignoring thinking and chatter', () => {
  assert.equal(extractGameFile(fenced('html', GAME)), GAME.trim() + '\n');
  assert.equal(extractGameFile(`\`\`\`css\nbody {}\n\`\`\`\n${fenced('', GAME)}`), GAME.trim() + '\n', 'a CSS block is not the game');
  assert.equal(extractGameFile(`<think>${fenced('html', '<script id="game-info">no</script>')}</think>${fenced('html', GAME)}`), GAME.trim() + '\n');
  assert.equal(extractGameFile(`Sure:\n${GAME}`), GAME.trim() + '\n', 'no fence: from the game info on');
  assert.equal(extractGameFile('Sorry, I cannot help with that.'), null);
  assert.equal(extractGameFile(undefined), null);
});

test('extractDesign: from the first heading, unwrapping a markdown fence; missingHeadings', () => {
  assert.equal(extractDesign(`<think># no</think>Sure! Here is the design.\n\n${DESIGN}`), DESIGN.trim() + '\n');
  assert.equal(extractDesign(fenced('markdown', DESIGN)), DESIGN.trim() + '\n');
  assert.equal(extractDesign('No headings here.'), null);
  assert.deepEqual(missingHeadings(DESIGN, DESIGN_HEADINGS), []);
  assert.deepEqual(missingHeadings('# X\n## players\n## Rules', ['Players', 'Rules', 'Art']), ['Art']);
});

/** A design as the model sends it under headingsFormat: its title and one field per heading. */
function asFields(design) {
  const [head, ...sections] = design.trim().split(/^## /m);
  const fields = { title: head.replace(/^# /, '').trim() };
  for (const s of sections) {
    const [heading, ...body] = s.split('\n');
    fields[heading.trim()] = body.join('\n').trim();
  }
  return fields;
}

test('headingsFormat + extractHeadings: every heading required, and the JSON reply turned back into the same Markdown', () => {
  const { schema } = headingsFormat('design').json_schema;
  assert.deepEqual(schema.required, ['title', ...DESIGN_HEADINGS]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(headingsFormat('plan').json_schema.schema.required, ['title', ...PLAN_HEADINGS]);

  const fields = asFields(DESIGN);
  assert.deepEqual(missingHeadings(extractHeadings(JSON.stringify(fields), DESIGN_HEADINGS), DESIGN_HEADINGS), []);
  assert.equal(extractHeadings(`<think>{"no": 1}</think>${JSON.stringify(fields)}`, DESIGN_HEADINGS), DESIGN.trim().replace(/\n{3,}/g, '\n\n') + '\n');

  // An empty section is left out (so it counts as missing); a repeated heading is dropped.
  const odd = extractHeadings(JSON.stringify({ ...fields, Art: '  ', Rules: '## Rules\nRun.' }), DESIGN_HEADINGS);
  assert.deepEqual(missingHeadings(odd, DESIGN_HEADINGS), ['Art']);
  assert.match(odd, /## Rules\nRun\./);

  // A plan's title gets "Change: " once; a reply that isn't the JSON is read as Markdown.
  const plan = { title: 'Faster rounds', 'What changes': '- 30 s rounds', 'What stays the same': 'Scoring', Risks: 'None' };
  assert.match(extractHeadings(JSON.stringify(plan), PLAN_HEADINGS, 'Change: '), /^# Change: Faster rounds\n\n## What changes\n- 30 s rounds/);
  assert.match(extractHeadings(JSON.stringify({ ...plan, title: 'Change: Faster rounds' }), PLAN_HEADINGS, 'Change: '), /^# Change: Faster rounds\n/);
  assert.equal(extractHeadings(`Sure!\n\n${DESIGN}`, DESIGN_HEADINGS), DESIGN.trim() + '\n');
  assert.equal(extractHeadings('[1, 2]', DESIGN_HEADINGS), null);
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

test('chat: sends the conversation (with the model\'s reasoning effort) and returns the reply', async () => {
  const { fetchImpl, calls } = fakeFetch([reply('hello')]);
  const result = await chat([{ role: 'user', content: 'hi' }], { model: 'qwen3.8:27b', baseUrl: 'https://x/api', apiKey: 'k', fetchImpl, sleep: noSleep });
  assert.equal(result.content, 'hello');
  assert.deepEqual(result.usage, { total_tokens: 5 });
  assert.equal(calls[0].url, 'https://x/api/chat/completions');
  assert.equal(calls[0].auth, 'Bearer k');
  assert.deepEqual(calls[0].body, { model: 'qwen3.8:27b', messages: [{ role: 'user', content: 'hi' }], stream: true, stream_options: { include_usage: true }, reasoning_effort: 'medium' });
});

/** A streamed reply, as GenAI Studio sends it: `data:` lines, split across network chunks. */
function streamed(pieces, { usage = { total_tokens: 9 }, hangAfter = null, finishReason = 'stop' } = {}) {
  const lines = [
    ...pieces.map(([field, text]) => `data: ${JSON.stringify({ choices: [{ delta: { [field]: text } }] })}\n\n`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [], usage })}\n\n`,
    'data: [DONE]\n\n',
  ];
  const bytes = new TextEncoder().encode(lines.join(''));
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.slice(i, i + 7)); // lines cut mid-way
  if (hangAfter !== null) chunks.length = hangAfter;
  return (signal) => ({
    status: 200,
    ok: true,
    headers: { get: () => 'text/event-stream; charset=utf-8' },
    body: {
      getReader: () => ({
        read: () =>
          chunks.length > 0
            ? Promise.resolve({ value: chunks.shift(), done: false })
            : hangAfter !== null
              ? new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
              : Promise.resolve({ value: undefined, done: true }),
      }),
    },
  });
}

test('chat: thinking until the context is full is "out of room", not the rate limit, and isn\'t tried again', async () => {
  const usage = { completion_tokens: 59_000 };
  const full = { body: { choices: [{ message: { content: '', reasoning_content: 'Let me write.' }, finish_reason: 'length' }], usage } };
  const { fetchImpl, calls } = fakeFetch([full, reply('never asked')]);
  const err = await chat([], { model: 'm', fetchImpl, sleep: noSleep }).catch((e) => e);
  assert.ok(err instanceof OutOfRoomError);
  assert.match(err.message, /ran out of room while thinking \(59,000 tokens\)/);
  assert.equal(err.thinking, 'Let me write.');
  assert.deepEqual(err.usage, usage);
  assert.equal(calls.length, 1);

  // Streamed, as GenAI Studio sends it: the finish reason comes in a chunk of its own.
  const fetchStream = async (_url, init) => streamed([['reasoning_content', 'Hmm.']], { finishReason: 'length' })(init.signal);
  assert.ok((await chat([], { model: 'm', fetchImpl: fetchStream, sleep: noSleep }).catch((e) => e)).outOfRoom);
});

test('chat: says why the reply stopped, and keeps any text the server sent as tool calls', async () => {
  const pieces = [['content', 'let ti=0;\n['], ['tool_calls', [{ index: 0, function: { name: 'f', arguments: '{"a":' } }]], ['tool_calls', [{ index: 0, function: { arguments: '1}' } }]]];
  const fetchImpl = async (_url, init) => streamed(pieces, { finishReason: 'tool_calls' })(init.signal);
  const result = await chat([], { model: 'm', fetchImpl, sleep: noSleep });
  assert.equal(result.content, 'let ti=0;\n[');
  assert.equal(result.finishReason, 'tool_calls');
  assert.equal(result.toolCalls, 'f({"a":1})');

  // Only tool calls and no content is not "empty": it comes back, to be seen.
  const only = async (_url, init) => streamed([['tool_calls', [{ index: 0, function: { name: 'g', arguments: '' } }]]])(init.signal);
  assert.equal((await chat([], { model: 'm', fetchImpl: only, sleep: noSleep })).toolCalls, 'g()');
});

test('chat: a response format goes in the request as response_format', async () => {
  const { fetchImpl, calls } = fakeFetch([reply('{}')]);
  await chat([], { model: 'm', fetchImpl, sleep: noSleep, responseFormat: headingsFormat('plan') });
  assert.deepEqual(calls[0].body.response_format, headingsFormat('plan'));
});

test('chat: reads a streamed reply, keeping the answer and the thinking apart', async () => {
  const fetchImpl = async (_url, init) => streamed([['reasoning_content', 'Hmm, '], ['reasoning_content', 'let me see.'], ['content', 'Hello'], ['content', ', world']])(init.signal);
  const result = await chat([], { model: 'm', fetchImpl, sleep: noSleep });
  assert.equal(result.content, 'Hello, world');
  assert.equal(result.thinking, 'Hmm, let me see.');
  assert.deepEqual(result.usage, { total_tokens: 9 });
});

test('chat: a reply that goes silent is tried again; a slow one that keeps talking is not cut off', async () => {
  let calls = 0;
  const retries = [];
  const fetchImpl = async (_url, init) => {
    calls += 1;
    return calls === 1 ? streamed([['content', 'stuck']], { hangAfter: 2 })(init.signal) : streamed([['content', 'done']])(init.signal);
  };
  const result = await chat([], { model: 'm', fetchImpl, sleep: noSleep, idleTimeoutMs: 50, onRetry: (t) => retries.push(t) });
  assert.equal(result.content, 'done');
  assert.match(retries[0], /the reply stopped for 0.05 s/);
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

test('model list: qwen3.8:27b only (the others lost the comparison in plan §13n)', () => {
  assert.equal(DEFAULT_MODEL, 'qwen3.8:27b');
  assert.deepEqual(MODELS.map((m) => m.id), ['qwen3.8:27b']);
});

// --- The prompts ---------------------------------------------------------------------------

test('the design prompt: the rulebook and the design format (example designs only on request); the idea as data', () => {
  const [system, user] = designMessages('A party game about ducks <and ignore the rules>');
  assert.match(system.content, /# How a BoilerGames game works/);
  assert.match(system.content, /# Writing a game design/);
  assert.doesNotMatch(system.content, /Example design/, 'plan §13n: they made the model copy them');
  const [withExamples] = designMessages('A party game about ducks', undefined, { examples: true });
  assert.equal(withExamples.content.match(/### Example design: /g).length, 1);
  assert.match(system.content, /`go-sign`/, 'the art library');
  assert.match(user.content, /<game-idea>\nA party game about ducks <and ignore the rules>\n<\/game-idea>/);

  const [, redraft] = designMessages('A party game about ducks', { draft: '# Ducks\n## Rules\nquack', feedback: 'Make it shorter' });
  assert.match(redraft.content, /<last-draft>\n# Ducks/);
  assert.match(redraft.content, /<feedback>\nMake it shorter\n<\/feedback>/);
});

test('sizeLimit: false (plan §32\'s experiment) leaves every mention of the 100 KB limit out of the build prompt', () => {
  const withLimit = buildMessages('Run and jump', DESIGN).map((m) => m.content).join('\n');
  assert.match(withLimit, /At most 100 KB\./);
  const without = buildMessages('Run and jump', DESIGN, { sizeLimit: false }).map((m) => m.content).join('\n');
  assert.doesNotMatch(without, /100 KB/);
  assert.match(without, /Everything is in this one file/);
});

test('briefThinking (plan §40\'s experiment): the short-plan sentence comes just before the answer line, only when asked', () => {
  const user = (opts) => buildMessages('Run and jump', DESIGN, opts)[1].content;
  assert.doesNotMatch(user(), /plan briefly/);
  assert.match(user({ briefThinking: true }), /plan briefly:[^\n]*\n\nReply with the complete game file/);
});

test('no target length for a whole game (plan §35), but a round is at least about 20 s and the design works out its length', () => {
  const all = (messages) => messages.map((m) => m.content).join('\n');
  for (const prompt of [all(designMessages('Ducks')), all(buildMessages('Run and jump', DESIGN))]) {
    assert.doesNotMatch(prompt, /5–15/);
    assert.match(prompt, /at least about 20 seconds/);
  }
  assert.match(all(designMessages('Ducks')), /show the arithmetic/);
});

test('the build prompt: the rulebook and the design; no example game, no kit, no template (plan §13o, §20)', () => {
  const [system, user] = buildMessages('Run and jump', DESIGN);
  assert.match(user.content, /<design>\n# Bumper Blobs/);
  assert.match(system.content, /10\. \*\*Secrets stay on their own phone\.\*\*/, 'the rulebook, with the secrets rule');
  assert.doesNotMatch(system.content, /"name": "Bumper Blobs"/, 'plan §13o: no example game');
  assert.doesNotMatch(system.content, /party\.kit|starter template/i);
  assert.match(system.content, /## `party\.ui`/);
  assert.match(system.content, /Give\s+the game its own look/);
});

test('change prompts: the plan sees the design, code and request; the build gets the approved plan', () => {
  const change = { idea: 'Run and jump', design: DESIGN, source: GAME, request: 'Add a fourth level', earlierRequests: ['Make it faster'] };
  const [, plan] = planMessages(change);
  assert.match(plan.content, /<design>\n# Bumper Blobs/);
  assert.match(plan.content, /```html\n<script type="application\/json" id="game-info">/);
  assert.match(plan.content, /<earlier-changes>\n- Make it faster/);
  assert.match(plan.content, /<change-request>\nAdd a fourth level/);
  const [, withPlan] = changeBuildMessages(change, '# Change: level 4\n## What changes\n- a level');
  assert.match(withPlan.content, /<plan>\n# Change: level 4/);
  assert.match(withPlan.content, /CHANGES:/);
  const [, smallFix] = changeBuildMessages(change, null);
  assert.match(smallFix.content, /Make this small change/);
});

// --- The jobs, with a fake model and checker -------------------------------------------------

/** A fake model that answers with each of `replies` in turn, and remembers what it was asked. */
function fakeModel(replies) {
  const calls = [];
  const chatFn = async (messages, opts) => {
    calls.push(messages.map((m) => ({ ...m })));
    calls.at(-1).responseFormat = opts?.responseFormat;
    return { content: replies.shift(), thinking: 'Let me think.', finishReason: 'stop', toolCalls: '', seconds: 1, usage: null };
  };
  return { chatFn, calls };
}
const passing = async () => ({ ok: true, problems: [], warnings: [], checked: 'fake' });

test('design job: one call, the design comes back; a draft missing headings is asked for again', async () => {
  const one = fakeModel([`Sure!\n\n${DESIGN}`]);
  const steps = [];
  const result = await runJob({ step: 'design', idea: 'A racing platformer for friends' }, { chatFn: one.chatFn, onStep: (t) => steps.push(t) });
  assert.equal(result.ok, true);
  assert.equal(result.design, DESIGN.trim() + '\n');
  assert.equal(one.calls.length, 1);
  assert.match(steps[0], /design: asking qwen3.8:27b/);

  const two = fakeModel(['# Short\n## Rules\nRun.', DESIGN]);
  const retried = await runJob({ step: 'design', idea: 'A racing platformer for friends' }, { chatFn: two.chatFn });
  assert.equal(retried.ok, true);
  assert.match(two.calls[1].at(-1).content, /missing these headings: Genre and feel, Players/);

  const never = await runJob({ step: 'design', idea: 'A racing platformer for friends' }, { chatFn: fakeModel(['I cannot.', 'Still no.']).chatFn });
  assert.equal(never.ok, false);
  assert.match(never.error, /no design/);

  // The reply is held to the headings (plan §39) and may come back as JSON.
  assert.equal(one.calls[0].responseFormat.json_schema.name, 'design');
  const json = await runJob({ step: 'design', idea: 'A racing platformer for friends' }, { chatFn: fakeModel([JSON.stringify(asFields(DESIGN))]).chatFn });
  assert.equal(json.ok, true);
  assert.match(json.design, /^# Bumper Blobs\n\n## Genre and feel\n/);

  // The thinking is kept only when the job asks (plan §38).
  assert.equal(result.attempts[0].thinking, undefined);
  const kept = await runJob({ step: 'design', idea: 'A racing platformer for friends', keepThinking: true }, { chatFn: fakeModel([DESIGN]).chatFn });
  assert.equal(kept.attempts[0].thinking, 'Let me think.');
  assert.equal(kept.attempts[0].reply, DESIGN);
  assert.equal(kept.attempts[0].finishReason, 'stop');
  assert.equal(result.attempts[0].finishReason, 'stop', 'why it stopped is always kept');
});

test('plan job: a change gets a plan with the plan headings', async () => {
  const plan = '# Change: faster\n## What changes\n- Run 9 tiles/s\n## What stays the same\n- Levels\n## Risks\nNone';
  const model = fakeModel([plan]);
  const result = await runJob({ step: 'design', idea: 'A racing platformer for friends', change: { request: 'Make running faster', source: GAME } }, { chatFn: model.chatFn });
  assert.equal(result.ok, true);
  assert.equal(result.design, plan + '\n');
  assert.match(model.calls[0][0].content, /Writing a change plan/);
});

test('build job (edit mode off): write → check → fix until it passes; the report goes back to the model', async () => {
  const broken = GAME.replace('party.ready(', 'fetch("/x"); party.ready(');
  const model = fakeModel([fenced('html', broken), 'no code, sorry', fenced('html', GAME)]);
  let checks = 0;
  const check = async (source) => {
    checks += 1;
    return source.includes('fetch')
      ? { ok: false, problems: [{ rule: 'network', line: 12, message: '`fetch` is blocked.', code: 'fetch("/x");', screen: 'big screen' }], warnings: [] }
      : passing();
  };
  const result = await runJob({ step: 'build', idea: 'A racing platformer for friends', design: DESIGN, edits: false }, { chatFn: model.chatFn, check });
  assert.equal(result.ok, true);
  assert.equal(checks, 2);
  assert.deepEqual(result.attempts.map((a) => a.mode), ['whole', 'whole', 'whole']);
  assert.deepEqual(result.attempts.map((a) => a.ok), [false, false, true]);
  // Every attempt keeps its code and report (for the version's history).
  assert.match(result.attempts[0].source, /fetch\("\/x"\)/);
  assert.equal(result.attempts[0].report.problems[0].rule, 'network');
  assert.deepEqual([result.attempts[1].source, result.attempts[1].report.problems], [null, ['The reply had no game file.']]);
  // Each request carries the prompt plus only the latest file (the context is 65K tokens);
  // a reply with no code is answered in the same conversation, so the problems stay in it.
  assert.deepEqual(model.calls.map((c) => c.length), [2, 4, 6]);
  assert.equal(model.calls[2][4].content, 'no code, sorry');
  const fix = model.calls[1].at(-1).content;
  assert.match(fix, /line 12: `fetch` is blocked\.\n {4}code: fetch\("\/x"\); \(on the big screen\)/);
  assert.match(model.calls[2].at(-1).content, /no game file/);
});

test('build job: an attempt that ran out of room is recorded (with its thinking, if kept), and the next asks again', async () => {
  const model = fakeModel([fenced('html', GAME)]);
  let first = true;
  const chatFn = async (messages, opts) => {
    if (!first) return model.chatFn(messages, opts);
    first = false;
    throw new OutOfRoomError({ thinking: 'Wait. Actually…', usage: { completion_tokens: 59_000 }, seconds: 900 });
  };
  const steps = [];
  const result = await runJob({ step: 'build', idea: 'A racing platformer for friends', design: DESIGN, keepThinking: true }, { chatFn, check: passing, onStep: (t) => steps.push(t) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.attempts.map((a) => [a.ok, a.outOfRoom ?? false]), [[false, true], [true, false]]);
  assert.equal(result.attempts[0].thinking, 'Wait. Actually…');
  assert.deepEqual(result.attempts[0].usage, { completion_tokens: 59_000 });
  assert.ok(steps.includes('attempt 1/4: the model ran out of room while thinking (59,000 tokens) and wrote no reply'));
  assert.equal(model.calls[0].length, 2, 'the same request again');
});

test('build job: gives up after the attempts, keeping the last game and report; too big fails', async () => {
  const failing = async () => ({ ok: false, problems: ['nope'], warnings: [] });
  const result = await runJob({ step: 'build', idea: 'A racing platformer for friends', design: DESIGN, maxAttempts: 2 }, { chatFn: fakeModel([fenced('html', GAME), fenced('html', GAME)]).chatFn, check: failing });
  assert.equal(result.ok, false);
  assert.match(result.error, /after 2 attempts/);
  assert.equal(result.source, GAME.trim() + '\n');

  const huge = `${GAME}<!-- ${'x'.repeat(110 * 1024)} -->\n`;
  const big = await runJob({ step: 'build', idea: 'A racing platformer for friends', design: DESIGN, maxAttempts: 1 }, { chatFn: fakeModel([fenced('html', huge)]).chatFn, check: passing });
  assert.equal(big.ok, false);
  assert.match(big.report.problems[0].message, /the limit is 100 KB/);
});

test('build job for a change: the changelog is kept', async () => {
  const model = fakeModel([`CHANGES:\n- Faster running\n\n${fenced('html', GAME)}`]);
  const job = { step: 'build', idea: 'A racing platformer for friends', change: { request: 'Make running faster', source: GAME, plan: null } };
  const result = await runJob(job, { chatFn: model.chatFn, check: passing });
  assert.equal(result.ok, true);
  assert.equal(result.changelog, '- Faster running');
});

test('bad jobs are refused before any model call', async () => {
  const model = fakeModel([]);
  const cases = [
    [null, /must be an object/],
    [{ step: 'design', idea: 'short' }, /idea must be/],
    [{ step: 'design', idea: 'A long enough idea', model: 'gpt-9' }, /unknown model/],
    [{ step: 'build', idea: 'A long enough idea' }, /needs the approved design/],
    [{ step: 'dance', idea: 'A long enough idea' }, /must be "design" or "build"/],
    [{ step: 'design', idea: 'A long enough idea', change: { request: 'Make it better please', source: '' } }, /current game file/],
    [{ step: 'design', idea: 'A long enough idea', change: { request: 'Make it better please', source: 'x'.repeat(110_000) } }, /too big for the AI to change \(107 KB; at most 100 KB fits/],
    [{ step: 'build', idea: 'A long enough idea', edits: false, change: { request: 'Make it better please', source: 'x'.repeat(70_000) } }, /\(68 KB; at most 60 KB fits/],
    [{ step: 'build', idea: 'A long enough idea', design: 'd', edits: 'yes' }, /edits must be true or false/],
    [{ step: 'design', idea: 'A long enough idea', redraft: { draft: 'x' } }, /last draft/],
    [{ step: 'design', idea: 'A long enough idea', examples: 'no' }, /examples must be true or false/],
    [{ step: 'design', idea: 'A long enough idea', keepThinking: 1 }, /keepThinking must be true or false/],
    [{ step: 'build', idea: 'A long enough idea', design: 'd', briefThinking: 'yes' }, /briefThinking must be true or false/],
  ];
  for (const [job, error] of cases) assert.match((await runJob(job, { chatFn: model.chatFn })).error, error);
  assert.equal(model.calls.length, 0);
});

test('formatReport: problems with their line and screen, then warnings', () => {
  const text = formatReport({ problems: ['no game info', { message: 'Threw', line: 3, code: 'x()', screen: 'phone 1', count: 2 }], warnings: [{ message: 'Never saves' }] });
  assert.equal(text, 'Problems (each must be fixed):\n- no game info\n- line 3: Threw\n    code: x() (on the phone 1, 2 times)\n\nAlso worth fixing:\n- Never saves');
});

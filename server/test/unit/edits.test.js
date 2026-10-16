import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEdits, applyEdits, applyReply, hasEdits, withoutEdits } from '../../../generator/src/edits.js';
import { changeBuildMessages, fixMessage, editsFailedMessage, EDIT_FORMAT } from '../../../generator/src/prompt.js';
import { runJob } from '../../../generator/src/run.js';

// Edit mode (plan §23): the model sends search/replace blocks instead of the whole file.
// Parsing them, applying them (strictly: all or nothing), every failure message, the prompts,
// and the build loop with a fake model: edits, edits that don't fit, and the fallback to
// whole files.

const GAME = readFileSync(new URL('../fixtures/tap-test.html', import.meta.url), 'utf8');
const block = (search, replace) => `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;

// --- Parsing -----------------------------------------------------------------------------------

test('parseEdits: blocks in order, ignoring thinking, chatter and fences; FIND works too', () => {
  const reply = `<think>\n${block('not this', 'nor this')}\n</think>CHANGES:\n- Faster\n\n\`\`\`\n${block('a = 1;', 'a = 2;')}\n\`\`\`\n\n<<<<<<< FIND\nb();\nc();\n=======\n>>>>>>> REPLACE\n`;
  const { edits, failures } = parseEdits(reply);
  assert.deepEqual(failures, []);
  assert.deepEqual(edits, [
    { search: 'a = 1;', replace: 'a = 2;' },
    { search: 'b();\nc();', replace: '' },
  ]);
  assert.equal(hasEdits(reply), true);
  assert.equal(hasEdits('just words'), false);
  assert.equal(withoutEdits(`CHANGES:\n- x\n${block('a', 'b')}\nbye`), 'CHANGES:\n- x\nbye');
});

test('parseEdits: Windows line endings, and markers a few characters long or short', () => {
  const { edits } = parseEdits('<<<<<< SEARCH\r\nx\r\n========\r\ny\r\n>>>>>>>> REPLACE\r\n');
  assert.deepEqual(edits, [{ search: 'x', replace: 'y' }]);
});

test('parseEdits: an unfinished block is a failure, and the next block still counts', () => {
  const { edits, failures } = parseEdits(`<<<<<<< SEARCH\nx\n=======\ny\n${block('a', 'b')}`);
  assert.deepEqual(edits, [{ search: 'a', replace: 'b' }]);
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /^edit 1 isn't finished: each edit needs a <<<<<<< SEARCH line, a ======= line and a >>>>>>> REPLACE line/);
});

// --- Applying -------------------------------------------------------------------------------

const FILE = 'const A = 1;\nfunction go() {\n  move();\n  draw();\n}\nfunction stop() {\n  draw();\n}\n';

test('applyEdits: in order, each on the file as the edits before left it', () => {
  const result = applyEdits(FILE, [
    { search: 'const A = 1;', replace: 'const A = 2;\nconst B = 3;' },
    { search: 'const B = 3;', replace: 'const B = 4;' },
  ]);
  // Edit 2 finds text that edit 1 wrote: two edits on the same lines, so it's refused.
  assert.equal(result.ok, false);
  assert.match(result.failures[0].message, /^edit 2: this text overlaps what edit 1 already changed\. Put both changes in one edit\./);

  const ok = applyEdits(FILE, [
    { search: 'const A = 1;', replace: 'const A = 2;' },
    { search: 'function go() {\n  move();', replace: 'function go() {\n  jump();\n  move();' },
    { search: 'function stop() {\n  draw();\n}\n', replace: '' },
  ]);
  assert.deepEqual(ok, { ok: true, source: 'const A = 2;\nfunction go() {\n  jump();\n  move();\n  draw();\n}\n' });
});

test('applyEdits: trailing spaces are forgiven, indentation is not', () => {
  const file = 'if (x) {  \n  hit();\t\n}\n';
  assert.deepEqual(applyEdits(file, [{ search: 'if (x) {\n  hit();', replace: 'if (x) {\n  hit(2);' }]), { ok: true, source: 'if (x) {\n  hit(2);\n}\n' });
  const wrongIndent = applyEdits(file, [{ search: 'if (x) {\nhit();', replace: '' }]);
  assert.equal(wrongIndent.ok, false);
  assert.match(wrongIndent.failures[0].message, /isn't in the file/);
});

test('applyEdits: every failure, each with its number; nothing is applied if any fails', () => {
  const result = applyEdits(FILE, [
    { search: 'const A = 1;', replace: 'const A = 9;' },
    { search: 'jump();', replace: 'x' },
    { search: '  draw();', replace: 'x' },
    { search: '  \n', replace: 'x' },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.source, undefined, 'no half-changed file');
  assert.deepEqual(
    result.failures.map((f) => f.message),
    [
      'edit 2: this text isn\'t in the file: "jump();". Copy the lines exactly as they are in the file now, with the same indentation.',
      'edit 3: this text matches 2 places in the file: "draw();". Include more lines around it, so it matches only one.',
      'edit 4: the SEARCH part is empty. Copy at least one whole line from the file, so the edit knows where to go.',
    ],
  );
  const multi = applyEdits(FILE, [{ search: 'nope();\nmore();', replace: '' }]);
  assert.match(multi.failures[0].message, /"nope\(\);" \(the first line of it\)/);
  assert.match(applyEdits(FILE, []).failures[0].message, /^The reply had no edits/);
});

test('applyReply: the whole new file, or the failures as lines for the model', () => {
  assert.deepEqual(applyReply(FILE, `CHANGES:\n- two\n${block('const A = 1;', 'const A = 2;')}`), { ok: true, source: FILE.replace('1', '2'), edits: 1 });
  assert.deepEqual(applyReply(FILE, '<<<<<<< SEARCH\nx'), { ok: false, failures: [parseEdits('<<<<<<< SEARCH\nx').failures[0].message] });
  assert.deepEqual(applyReply(FILE, 'sorry'), { ok: false, failures: [applyEdits(FILE, []).failures[0].message] });
});

// --- The prompts ------------------------------------------------------------------------------

test('edit prompts: the format with one example; a change asks for CHANGES then edits; fixes say what failed', () => {
  assert.match(EDIT_FORMAT, /<<<<<<< SEARCH\nconst ROUND_SECONDS = 60;\n=======\nconst ROUND_SECONDS = 90;\n>>>>>>> REPLACE/);
  // The format's own example is valid edits.
  assert.equal(parseEdits(EDIT_FORMAT).failures.length, 0);

  const change = { idea: 'Tap fast', source: GAME, request: 'Add a fourth round' };
  const [, edits] = changeBuildMessages(change, null);
  assert.match(edits.content, /```html\n<script type="application\/json" id="game-info">/, 'the code is there to edit');
  assert.match(edits.content, /CHANGES:[\s\S]*Your edits to the code\.\n\nReply with EDITS, not the whole file/);
  const [, whole] = changeBuildMessages(change, null, { edits: false });
  assert.match(whole.content, /The complete new game file in ONE ```html code block/);
  assert.doesNotMatch(whole.content, /<<<<<<< SEARCH/);
  const [, noCode] = changeBuildMessages(change, '# Change: four', { withCode: false });
  assert.doesNotMatch(noCode.content, /game-info/, 'a fix shows the code as the model\'s reply instead');
  assert.match(noCode.content, /<plan>\n# Change: four/);

  assert.match(fixMessage('- broke', { edits: true }), /- broke\n\nFix every problem\. Your file above is the code now\.\n\nReply with EDITS/);
  assert.match(fixMessage('- broke'), /complete corrected game file/);
  assert.equal(editsFailedMessage(['edit 2: nope']).split('\n')[2], '- edit 2: nope');
});

// --- The build loop, with a fake model ------------------------------------------------------------

function fakeModel(replies) {
  const calls = [];
  const chatFn = async (messages) => {
    calls.push(messages.map((m) => ({ ...m })));
    return { content: replies.shift(), seconds: 1, usage: { prompt_tokens: 10, completion_tokens: 5 } };
  };
  return { chatFn, calls };
}
const passing = async () => ({ ok: true, problems: [], warnings: [] });
const changeJob = (extra = {}) => ({ step: 'build', idea: 'A tapping race for friends', change: { request: 'Make the goal 30 taps', source: GAME, plan: null }, ...extra });
const goal = GAME.match(/.*=== 3\).*/)?.[0];

test('a change in edit mode: the edits are applied to the old game and the result is a whole file', async () => {
  assert.ok(goal, 'the fixture has the goal line');
  const model = fakeModel([`CHANGES:\n- The goal is 30 taps\n\n${block(goal, goal.replace('=== 3', '=== 30'))}`]);
  const result = await runJob(changeJob(), { chatFn: model.chatFn, check: passing });
  assert.equal(result.ok, true);
  assert.equal(result.source, GAME.replace(goal, goal.replace('=== 3', '=== 30')));
  assert.equal(result.changelog, '- The goal is 30 taps');
  assert.deepEqual(result.attempts.map((a) => [a.mode, a.ok]), [['edits', true]]);
  assert.match(model.calls[0][1].content, /Reply with EDITS/);
});

test('edits that don\'t fit go back to the model with what failed; the conversation keeps its reply', async () => {
  const model = fakeModel([`CHANGES:\n- Goal 30\n${block('goal = 99;', 'goal = 30;')}`, block(goal, goal.replace('=== 3', '=== 30'))]);
  const result = await runJob(changeJob(), { chatFn: model.chatFn, check: passing });
  assert.equal(result.ok, true);
  assert.equal(result.changelog, '- Goal 30', 'from the first reply: the retry needn\'t repeat it');
  const [failed, passed] = result.attempts;
  assert.deepEqual([failed.mode, failed.ok, failed.source, failed.problems], ['edits', false, null, 1]);
  assert.match(failed.report.problems[0], /^edit 1: this text isn't in the file: "goal = 99;"/);
  assert.equal(passed.mode, 'edits');
  const second = model.calls[1];
  assert.equal(second.length, 4);
  assert.match(second[2].content, /goal = 99;/, 'its own failed reply');
  assert.match(second[3].content, /None of your edits were applied[\s\S]*- edit 1: this text isn't in the file/);
});

test('edits that fail twice in a row: the whole file is asked for instead, and the job stays that way', async () => {
  const bad = block('nope();', 'x');
  const model = fakeModel([bad, bad, `CHANGES:\n- Goal 30\n\`\`\`html\n${GAME}\`\`\``]);
  const steps = [];
  const result = await runJob(changeJob(), { chatFn: model.chatFn, check: passing, onStep: (t) => steps.push(t) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.attempts.map((a) => a.mode), ['edits', 'edits', 'whole']);
  assert.ok(steps.includes('edits failed twice: asking for the whole file instead'));
  // Nothing had been applied yet: it's the whole-file change prompt, from the start.
  assert.equal(model.calls[2].length, 2);
  assert.match(model.calls[2][1].content, /The complete new game file in ONE ```html code block/);
});

test('no fallback for a game too big to send whole: it keeps asking for edits', async () => {
  const big = `${GAME}<!-- ${'x'.repeat(70 * 1024)} -->\n`;
  const bad = block('nope();', 'x');
  const model = fakeModel([bad, bad, bad]);
  const result = await runJob(changeJob({ maxAttempts: 3, change: { request: 'Make the goal 30 taps', source: big, plan: null } }), { chatFn: model.chatFn, check: passing });
  assert.equal(result.ok, false);
  assert.deepEqual(result.attempts.map((a) => a.mode), ['edits', 'edits', 'edits']);
  assert.equal(model.calls[2].length, 6, 'the failed replies stay in the conversation');
});

test('a first build: attempt 1 writes the whole file, the fixes are edits to it', async () => {
  const broken = GAME.replace(goal, `${goal}\nfetch("/x");`);
  const model = fakeModel([`\`\`\`html\n${broken}\`\`\``, block('fetch("/x");\n', '')]);
  const check = async (source) => (source.includes('fetch') ? { ok: false, problems: ['`fetch` is blocked.'], warnings: [] } : passing());
  const result = await runJob({ step: 'build', idea: 'A tapping race for friends', design: '# Tap\n## Rules\nTap.' }, { chatFn: model.chatFn, check });
  assert.equal(result.ok, true);
  assert.deepEqual(result.attempts.map((a) => [a.mode, a.ok]), [['whole', false], ['edits', true]]);
  assert.equal(result.source, broken.replace('fetch("/x");\n', ''));
  const fix = model.calls[1];
  assert.equal(fix.length, 4);
  assert.match(fix[2].content, /^```html\n<script type="application\/json" id="game-info">/, 'its file, as its own reply');
  assert.match(fix[3].content, /`fetch` is blocked\.[\s\S]*Your file above is the code now\.[\s\S]*<<<<<<< SEARCH/);
});

test('a change\'s fix: the old code is left out of the prompt, so the game is in the conversation once', async () => {
  const model = fakeModel([block(goal, `${goal}\nfetch("/x");`), block('fetch("/x");', '')]);
  const check = async (source) => (source.includes('fetch') ? { ok: false, problems: ['`fetch` is blocked.'], warnings: [] } : passing());
  const result = await runJob(changeJob(), { chatFn: model.chatFn, check });
  assert.equal(result.ok, true);
  const fix = model.calls[1];
  assert.doesNotMatch(fix[1].content, /game-info/);
  assert.match(fix[1].content, /<change-request>\nMake the goal 30 taps/);
  assert.match(fix[2].content, /fetch\("\/x"\)/, 'the changed file is the model\'s reply');
});

test('after a fallback, a failed check is fixed with a whole file too', async () => {
  const broken = GAME.replace(goal, `${goal}\nfetch("/x");`);
  const bad = block('nope();', 'x');
  const model = fakeModel([bad, bad, `\`\`\`html\n${broken}\`\`\``, `\`\`\`html\n${GAME}\`\`\``]);
  const check = async (source) => (source.includes('fetch') ? { ok: false, problems: ['`fetch` is blocked.'], warnings: [] } : passing());
  const result = await runJob(changeJob(), { chatFn: model.chatFn, check });
  assert.equal(result.ok, true);
  assert.deepEqual(result.attempts.map((a) => a.mode), ['edits', 'edits', 'whole', 'whole']);
  assert.match(model.calls[3][3].content, /complete corrected game file/);
});

test('edit mode off: a change is whole files, as before plan §23', async () => {
  const model = fakeModel([`CHANGES:\n- Same\n\`\`\`html\n${GAME}\`\`\``]);
  const result = await runJob(changeJob({ edits: false }), { chatFn: model.chatFn, check: passing });
  assert.deepEqual(result.attempts.map((a) => a.mode), ['whole']);
  assert.doesNotMatch(model.calls[0][1].content, /<<<<<<< SEARCH/);
});

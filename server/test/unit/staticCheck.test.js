import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { staticCheck, scanJs } from '../../src/games/staticCheck.js';

const INFO = '<script type="application/json" id="game-info">{ "name": "T", "description": "", "minPlayers": 1, "maxPlayers": 4 }</script>';

/** A game file whose script is `body`, plus the two calls every game makes. */
const game = (body, extraHtml = '') => `${INFO}\n${extraHtml}\n<script>\nparty.ready(() => {});\nparty.end({ rankings: [] });\n${body}\n</script>\n`;
const rulesOf = (findings) => findings.map((f) => f.rule);

test('the official games, the templates and the test games pass', () => {
  const files = [
    '../../src/games/bumper-blobs/game.html',
    '../../src/games/tower-dash/game.html',
    '../../src/games/dungeon-party/game.html',
    '../../../generator/templates/rounds.html',
    '../../../generator/templates/realtime.html',
    '../../../generator/templates/turns.html',
    '../fixtures/tap-test.html',
  ];
  for (const file of files) {
    const { errors } = staticCheck(readFileSync(new URL(file, import.meta.url), 'utf8'));
    assert.deepEqual(errors, [], file);
  }
});

test('each kind of mistake is caught, with its line', () => {
  const cases = [
    ['fetch("/api/me")', 'network'],
    ['const ws = new WebSocket("wss://x")', 'network'],
    ['navigator.sendBeacon("/x", "y")', 'network'],
    ['new Worker("w.js")', 'network'],
    ['import("./other.js")', 'network'],
    ['location.href = "https://example.com"', 'navigation'],
    ['window.location = "/"', 'navigation'],
    ['location = "/"', 'navigation'],
    ['document.location.reload()', 'navigation'],
    ['window.open("https://example.com")', 'navigation'],
    ['app.innerHTML = \'<a href="https://example.com">win a prize</a>\'', 'navigation'],
    ['eval("1 + 1")', 'eval'],
    ['new Function("return 1")', 'eval'],
    ['setTimeout("tick()", 10)', 'eval'],
    ['window.parent.document.title', 'page'],
    ['top.location', 'page'],
    ['postMessage("hi", "*")', 'page'],
    ['localStorage.setItem("x", 1)', 'storage'],
    ['document.cookie', 'storage'],
    ['alert("You win!")', 'dialog'],
    ['document.write("<p>hi</p>")', 'dialog'],
  ];
  for (const [line, rule] of cases) {
    const { errors } = staticCheck(game(line));
    assert.ok(rulesOf(errors).includes(rule), `${line} → ${rule}, got ${JSON.stringify(errors)}`);
    const found = errors.find((e) => e.rule === rule);
    assert.equal(found.line, 6, line);
    assert.equal(found.code, line.slice(0, 160));
  }
});

test('markup mistakes: links, forms, refresh, outside scripts, fonts and pictures', () => {
  const cases = [
    ['<a href="https://example.com">Click</a>', 'navigation'],
    ['<form><input name="q"></form>', 'navigation'],
    ['<meta http-equiv="refresh" content="0; url=https://example.com">', 'navigation'],
    ['<script src="https://cdn.example.com/lib.js"></script>', 'outside'],
    ['<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto">', 'outside'],
    ['<img src="https://example.com/cat.png">', 'outside'],
    ['<iframe></iframe>', 'outside'],
    ['<style>@import url("https://fonts.googleapis.com/css");</style>', 'outside'],
    ['<div style="background: url(//example.com/bg.png)"></div>', 'outside'],
  ];
  for (const [html, rule] of cases) {
    const { errors } = staticCheck(game('', html));
    assert.ok(rulesOf(errors).includes(rule), `${html} → ${rule}, got ${JSON.stringify(errors)}`);
    assert.equal(errors.find((e) => e.rule === rule).line, 2, html);
  }
});

test('words in strings, comments, regexes and templates are not code', () => {
  const body = [
    '// Go back to your location. Use fetch() later? alert(x)',
    '/* window.open(), localStorage */',
    'const tip = "Pick a location. Then alert(the others)!";',
    "const other = 'eval(this) or fetch(that)';",
    'const re = /location\\.href|fetch\\(/g;',
    'const t = `Move to the top. ${players.length} players; fetch(more)`;',
    'const ratio = a / b / c; // division, not a regex',
    'const myfetch = (x) => x; myfetch(1); obj.alert(2); game.location = 3;',
    'const tower = { top: 1 }; tower.top + 1;',
  ].join('\n');
  const { errors } = staticCheck(game(body, '<!-- <a href="https://example.com">old link</a> <script src="x.js"></script> -->'));
  assert.deepEqual(errors, []);
});

test('code inside ${ } in a template literal is still checked', () => {
  const { errors } = staticCheck(game('const t = `score: ${fetch("/x")}`;'));
  assert.deepEqual(rulesOf(errors), ['network']);
});

test('the game-info JSON and inline event handlers', () => {
  // The JSON block is data, not code.
  assert.deepEqual(staticCheck(game('')).errors, []);
  // onclick="…" is code.
  const { errors } = staticCheck(game('', '<button onclick="location.reload()">Again</button>'));
  assert.deepEqual(rulesOf(errors), ['navigation']);
});

test('a game that never calls party.ready fails; one that never ends is flagged', () => {
  const noReady = staticCheck(`${INFO}\n<script>party.end({ rankings: [] });</script>`);
  assert.deepEqual(rulesOf(noReady.errors), ['sdk']);
  const noEnd = staticCheck(`${INFO}\n<script>party.ready(() => {});</script>`);
  assert.deepEqual(noEnd.errors, []);
  assert.deepEqual(rulesOf(noEnd.warnings), ['sdk']);
});

test('outside addresses in strings are flagged, not failed', () => {
  const { errors, warnings } = staticCheck(game('const credit = "Art by https://example.com";'));
  assert.deepEqual(errors, []);
  assert.deepEqual(rulesOf(warnings), ['address']);
  assert.equal(warnings[0].line, 6);
});

test('line numbers stay right after emoji and other wide characters', () => {
  const { errors } = staticCheck(game('const s = "🎉🎉🎉 ★ ✓";\nfetch("/x");'));
  assert.equal(errors[0].line, 7);
});

test('scanJs keeps code and blanks strings and comments, keeping the length', () => {
  const src = 'a("x") // c\nb(`t ${y} t`)';
  const { code, text } = scanJs(src);
  assert.equal(code.length, src.length);
  assert.equal(code, 'a(" ")     \nb(`  ${y}  `)');
  assert.equal(text, 'a("x")     \nb(`t ${y} t`)');
});

import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { GameRegistry } from '../../src/games/registry.js';
import { readFrameGame, validateFrameGame, frameGameReport } from '../../src/games/frameGame.js';
import { createDefaultRegistry, OFFICIAL_GAMES } from '../../src/games/index.js';
import { config } from '../../src/config.js';
import { GAME_TAGS } from '../../src/games/tags.js';
import { tapGame, TAP_SOURCE } from '../helpers/frameGames.js';

// Frame game files (plan §13c) and the registry that offers them.

/** A game file with this info block (as raw text, so broken JSON can be tested too). */
const withInfo = (infoText) => TAP_SOURCE.replace(/(id="game-info">)[\s\S]*?(<\/script>)/, `$1${infoText}$2`);

test('readFrameGame: reads the info block with JSON.parse; the id comes from outside the file', () => {
  const result = readFrameGame(TAP_SOURCE, 'my-id');
  assert.equal(result.ok, true);
  assert.deepEqual(
    { ...result.game, source: undefined },
    { id: 'my-id', name: 'Tap Test', description: 'First to 3 taps wins. Test-only.', minPlayers: 1, maxPlayers: 12, source: undefined },
  );
  assert.equal(result.game.source, TAP_SOURCE, 'the whole file is kept, to send to browsers');
});

test('readFrameGame: tags and minutes are optional, for the catalogue (plan §14)', () => {
  const result = readFrameGame(withInfo('{ "name": "A", "description": "", "minPlayers": 1, "maxPlayers": 2, "tags": ["racing", "co-op"], "minutes": [5, 5] }'), 'x');
  assert.equal(result.ok, true, result.problems?.join('; '));
  assert.deepEqual([result.game.tags, result.game.minutes], [['racing', 'co-op'], [5, 5]]);
});

test('readFrameGame: the attributes may come in either order', () => {
  const swapped = TAP_SOURCE.replace('<script type="application/json" id="game-info">', "<script id='game-info' type='application/json'>");
  assert.equal(readFrameGame(swapped, 'x').ok, true);
});

test('readFrameGame reports each problem readably', () => {
  const cases = [
    [42, /must be text/],
    ['<p>no info</p>', /no game info/],
    [withInfo('{ name: oops }'), /isn't valid JSON/],
    [withInfo('[1, 2]'), /must be a JSON object/],
    [withInfo('{ "name": "A", "description": "", "minPlayers": 1, "maxPlayers": 2, "id": "evil" }'), /unknown field "id"/],
    [withInfo('{ "name": "", "description": "", "minPlayers": 1, "maxPlayers": 2 }'), /name must be/],
    [withInfo('{ "name": "A", "description": 5, "minPlayers": 1, "maxPlayers": 2 }'), /description must be/],
    [withInfo('{ "name": "A", "description": "", "minPlayers": 0, "maxPlayers": 2 }'), /minPlayers must be/],
    [withInfo('{ "name": "A", "description": "", "minPlayers": 1, "maxPlayers": 13 }'), /maxPlayers must be an integer of at most 12/],
    [withInfo('{ "name": "A", "description": "", "minPlayers": 4, "maxPlayers": 2 }'), /maxPlayers must be at least minPlayers/],
    [withInfo('{ "name": "A", "description": "", "minPlayers": 1, "maxPlayers": 2, "tags": [] }'), /tags must be a list of 1–4/],
    [withInfo('{ "name": "A", "description": "", "minPlayers": 1, "maxPlayers": 2, "tags": ["action", "action"] }'), /tags must be a list of 1–4 different/],
    [withInfo('{ "name": "A", "description": "", "minPlayers": 1, "maxPlayers": 2, "tags": ["platforming"] }'), /unknown tag "platforming" \(allowed: action/],
    [withInfo('{ "name": "A", "description": "", "minPlayers": 1, "maxPlayers": 2, "minutes": 10 }'), /minutes must be \[low, high\]/],
    [withInfo('{ "name": "A", "description": "", "minPlayers": 1, "maxPlayers": 2, "minutes": [10, 5] }'), /minutes must be/],
    [withInfo('{ "name": "A", "description": "", "minPlayers": 1, "maxPlayers": 2, "minutes": [0, 5] }'), /minutes must be/],
    [TAP_SOURCE + ' '.repeat(config.FRAME_GAME_MAX_BYTES), /the limit is/],
  ];
  for (const [source, pattern] of cases) {
    const result = readFrameGame(source, 'x');
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => pattern.test(p)), `${pattern}: ${result.problems.join('; ')}`);
  }
  assert.deepEqual(readFrameGame(TAP_SOURCE, 'Bad Id').problems, ['id must be 1–40 lowercase letters, digits, or dashes']);
});

test('frameGameReport: the shape versions store and the admin page shows', () => {
  assert.deepEqual(frameGameReport(TAP_SOURCE), {
    ok: true,
    problems: [],
    warnings: [],
    checked: 'the game info and the static check',
    game: { name: 'Tap Test', description: 'First to 3 taps wins. Test-only.' },
  });
  const bad = frameGameReport('export default {}; // a block game');
  assert.equal(bad.ok, false);
  assert.match(bad.problems[0], /no game info/);
  // The static check's findings point at lines.
  const fetching = frameGameReport(TAP_SOURCE.replace('party.ready(', 'fetch("/x"); party.ready('));
  assert.equal(fetching.ok, false);
  assert.equal(fetching.problems[0].rule, 'network');
  assert.equal(typeof fetching.problems[0].line, 'number');
});

test('register + get + list (list leaves out the game files)', () => {
  const registry = new GameRegistry();
  const game = tapGame();
  registry.register(game);
  assert.equal(registry.get('tap-test'), game);
  assert.equal(registry.get('nope'), undefined);
  assert.deepEqual(registry.list(), [
    {
      id: 'tap-test',
      name: 'Tap Test',
      description: 'First to 3 taps wins. Test-only.',
      minPlayers: 1,
      maxPlayers: 12,
      tags: [],
      minutes: null,
      addedAt: null,
      hasThumb: false,
      source: 'official',
    },
  ]);
});

test('register refuses invalid games with a readable message', () => {
  const registry = new GameRegistry();
  assert.throws(() => registry.register(tapGame('tap-test', { maxPlayers: 50 })), /can't be registered:\n - maxPlayers/);
  assert.deepEqual(validateFrameGame(null), ['a game must be an object']);
  assert.equal(registry.list().length, 0);
});

test('register refuses duplicate ids', () => {
  const registry = new GameRegistry();
  registry.register(tapGame());
  assert.throws(() => registry.register(tapGame()), /already registered/);
});

test('get does not find built-in object properties', () => {
  assert.equal(new GameRegistry().get('constructor'), undefined);
});

test("the generator's starter templates are valid frame games", () => {
  for (const name of ['rounds', 'realtime', 'turns']) {
    const source = readFileSync(new URL(`../../../generator/templates/${name}.html`, import.meta.url), 'utf8');
    const result = readFrameGame(source, `template-${name}`);
    assert.equal(result.ok, true, `${name}: ${result.problems?.join('; ')}`);
    assert.match(source, /TEMPLATE/, `${name} marks the parts to change`);
  }
});

test('the default registry offers the official games, each read from its game.html', () => {
  assert.deepEqual(createDefaultRegistry().list().map((g) => g.id), OFFICIAL_GAMES);
  const blobs = createDefaultRegistry().get('bumper-blobs');
  assert.deepEqual([blobs.name, blobs.minPlayers, blobs.maxPlayers], ['Bumper Blobs', 2, 12]);
  assert.match(blobs.source, /party\.ready/);
  for (const g of createDefaultRegistry().list()) {
    assert.ok(g.tags.length > 0 && g.minutes && g.hasThumb, `${g.id} has tags, a length and a picture for the catalogue`);
  }
  assert.deepEqual([...createDefaultRegistry().thumb('tower-dash').subarray(0, 2)], [0xff, 0xd8], 'a JPEG');
});

test("the rulebook lists exactly the allowed tags, in the same order (the AI reads it)", () => {
  const spec = readFileSync(new URL('../../../generator/spec/GAME_SPEC.md', import.meta.url), 'utf8');
  const line = /1–4 of exactly these words: ([^.]+)\./.exec(spec.replace(/\s+/g, ' '));
  assert.ok(line, 'the tags line is in GAME_SPEC.md');
  assert.deepEqual(line[1].split(', '), GAME_TAGS);
});

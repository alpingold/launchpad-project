import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRegistry } from '../../src/games/registry.js';
import { validateGameModule } from '../../src/games/contract.js';
import { createDefaultRegistry } from '../../src/games/index.js';
import countGame from '../fixtures/countGame.js';

const valid = () => ({ ...countGame });

test('the count game fixture follows the contract', () => {
  assert.deepEqual(validateGameModule(countGame), []);
});

test('validateGameModule reports each broken rule', () => {
  const cases = [
    [null, /must be an object/],
    [{ ...valid(), id: 'Count Game' }, /id must be/],
    [{ ...valid(), id: '' }, /id must be/],
    [{ ...valid(), name: '' }, /name must be/],
    [{ ...valid(), description: 5 }, /description must be/],
    [{ ...valid(), minPlayers: 0 }, /minPlayers must be/],
    [{ ...valid(), minPlayers: 1.5 }, /minPlayers must be/],
    [{ ...valid(), maxPlayers: 13 }, /maxPlayers must be an integer of at most 12/],
    [{ ...valid(), minPlayers: 4, maxPlayers: 2 }, /maxPlayers must be at least minPlayers/],
    [{ ...valid(), createGame: 'nope' }, /createGame must be a function/],
  ];
  for (const [mod, pattern] of cases) {
    const problems = validateGameModule(mod);
    assert.ok(problems.some((p) => pattern.test(p)), `${JSON.stringify(mod?.id)}: ${problems.join('; ')}`);
  }
});

test('register + get + list', () => {
  const registry = new GameRegistry();
  registry.register(countGame);
  assert.equal(registry.get('count-game'), countGame);
  assert.equal(registry.get('nope'), undefined);
  assert.deepEqual(registry.list(), [
    {
      id: 'count-game',
      name: 'Count to Three',
      description: 'First to tap the button enough times wins.',
      minPlayers: 1,
      maxPlayers: 12,
    },
  ]);
});

test('register refuses invalid games with a readable message', () => {
  const registry = new GameRegistry();
  assert.throws(() => registry.register({ ...valid(), maxPlayers: 50 }), /does not follow the game contract:\n - maxPlayers/);
  assert.equal(registry.list().length, 0);
});

test('register refuses duplicate ids', () => {
  const registry = new GameRegistry();
  registry.register(countGame);
  assert.throws(() => registry.register(valid()), /already registered/);
});

test('get does not find built-in object properties', () => {
  assert.equal(new GameRegistry().get('constructor'), undefined);
});

test('the default registry offers the demo game', () => {
  assert.deepEqual(createDefaultRegistry().list().map((g) => g.id), ['reaction-race']);
});

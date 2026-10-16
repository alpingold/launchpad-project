import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterGames, tagsInUse, NO_FILTERS } from '../../../client/src/components/catalogue.js';

// The catalogue's filters (plan §14) run in the browser; they're plain functions, tested here.

const game = (name, { tags = [], min = 1, max = 8, addedAt = null, description = '' } = {}) => ({
  name,
  description,
  tags,
  minPlayers: min,
  maxPlayers: max,
  addedAt,
});
const GAMES = [
  game('Tower Dash', { tags: ['platformer', 'racing'], description: 'Run and jump' }),
  game('Bumper Blobs', { tags: ['action'], min: 2, max: 12 }),
  game('Long Road', { tags: ['rpg', 'adventure'], max: 6, addedAt: 200 }),
  game('Checkpoint Dash', { tags: ['platformer', 'racing'], addedAt: 100 }),
];
const names = (filters) => filterGames(GAMES, { ...NO_FILTERS, ...filters }).map((g) => g.name);

test('no filters: every game, in the order given', () => {
  assert.deepEqual(names({}), ['Tower Dash', 'Bumper Blobs', 'Long Road', 'Checkpoint Dash']);
});

test('search: every word must appear in the name or description, any case', () => {
  assert.deepEqual(names({ search: 'dash' }), ['Tower Dash', 'Checkpoint Dash']);
  assert.deepEqual(names({ search: '  JUMP  tower ' }), ['Tower Dash']);
  assert.deepEqual(names({ search: 'nothing like this' }), []);
});

test('tags: a game needs all the chosen tags', () => {
  assert.deepEqual(names({ tags: ['platformer'] }), ['Tower Dash', 'Checkpoint Dash']);
  assert.deepEqual(names({ tags: ['platformer', 'action'] }), []);
});

test('players: only games that many people can play', () => {
  assert.deepEqual(names({ players: 1 }), ['Tower Dash', 'Long Road', 'Checkpoint Dash']);
  assert.deepEqual(names({ players: 7 }), ['Tower Dash', 'Bumper Blobs', 'Checkpoint Dash']);
  assert.deepEqual(names({ players: 12 }), ['Bumper Blobs']);
});

test('sort: A–Z, and newest (games with no date last)', () => {
  assert.deepEqual(names({ sort: 'name' }), ['Bumper Blobs', 'Checkpoint Dash', 'Long Road', 'Tower Dash']);
  assert.deepEqual(names({ sort: 'newest' }).slice(0, 2), ['Long Road', 'Checkpoint Dash']);
  assert.deepEqual(GAMES.map((g) => g.name), ['Tower Dash', 'Bumper Blobs', 'Long Road', 'Checkpoint Dash'], 'the list given is not changed');
});

test('tagsInUse: most used first, then A–Z', () => {
  assert.deepEqual(tagsInUse(GAMES), ['platformer', 'racing', 'action', 'adventure', 'rpg']);
});

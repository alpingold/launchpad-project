import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedWords, blockedFields, blockedMessage } from '../../src/games/wordFilter.js';

// The blocked words in a public game's name and description (plan §49).

const words = (text) => blockedWords(text).map((w) => w.word);

test('whole words, any capitals, with common endings, and where each one is', () => {
  assert.deepEqual(blockedWords('Vote, you Bastards'), [{ word: 'Bastards', start: 10, end: 18 }]);
  assert.deepEqual(words('bitch bitches pissed wankers'), ['bitch', 'bitches', 'pissed', 'wankers']);
  assert.deepEqual(words('Bass Ass'), ['Ass']);
});

test('digits and symbols for letters, stretched letters, and a few roots inside longer words', () => {
  assert.deepEqual(words('Holy SH1T, sh!t happens! a$$hole fuuuuck'), ['SH1T', 'sh!t', 'a$$hole', 'fuuuuck']);
  assert.deepEqual(words('Clusterfuck Mother-fucker Shitshow'), ['Clusterfuck', 'fucker', 'Shitshow']);
});

test('harmless words that contain or look like a blocked one are fine', () => {
  for (const text of [
    'Scunthorpe', 'class assess passes assassin', 'Cocktail', 'Moby Dick', 'Tit for tat', 'cum laude',
    'a chink in the armor', 'shiitake', 'Grass hopper', 'Titanic title', 'Wow!', 'Bumper Blobs', 'Stowaways',
  ]) {
    assert.deepEqual(words(text), [], text);
  }
});

test('blockedFields lists only the fields with blocked words; the message names them', () => {
  const blocked = blockedFields({ name: 'Shit Show', description: 'A fine game', about: 'Rules for wankers' });
  assert.deepEqual(blocked, [
    { field: 'name', text: 'Shit Show', words: [{ word: 'Shit', start: 0, end: 4 }] },
    { field: 'about', text: 'Rules for wankers', words: [{ word: 'wankers', start: 10, end: 17 }] },
  ]);
  assert.match(blockedMessage(blocked), /the name: "Shit"; About this game: "wankers"/);
  assert.deepEqual(blockedFields({ name: undefined, description: '' }), []);
});

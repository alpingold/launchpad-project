// Words a public game's name and description can't have (plan §49). Games go public without an
// admin looking first, so the catalogue's cards, which anyone sees, get this simple check: a
// list of swear words and slurs, matched as whole words. The creator is told which words to
// change; nothing is changed for them.
//
// Deliberately simple: it catches the obvious (any capitals, common endings like -s and -ing,
// digits for letters like "sh1t"), not every spelling, and never a word that only contains a
// blocked one ("Scunthorpe", "class", "assess"). Only a few words that never appear inside
// harmless ones count inside longer words too ("fuck" in "clusterfuck").

/** Whole words: blocked as they are, and with a common ending (see ENDINGS). */
const WORDS = [
  'arse', 'arsehole', 'ass', 'asshat', 'asshole', 'bastard', 'bitch', 'bollocks', 'bullshit',
  'cocksucker', 'coon', 'cunt', 'dickhead', 'dildo', 'douche', 'douchebag', 'dyke', 'fag', 'faggot',
  'fck', 'feck', 'gook', 'jackass', 'jizz', 'kike', 'nigga', 'nigger', 'paki', 'piss', 'porn',
  'pussy', 'rape', 'retard', 'skank', 'slut', 'spic', 'stfu', 'tits', 'titties', 'tranny', 'twat',
  'wank', 'wanker', 'wetback', 'whore', 'wtf',
];
// Left out on purpose, because they're everyday words or names too: dick (Moby Dick), cock
// (a rooster), tit (a bird, tit for tat), cum (cum laude), crap (craps), prick, shag, boner,
// chink (a chink in the armor).

/** Blocked even inside a longer word: none of these is part of a harmless English word. */
const ROOTS = ['fuck', 'shit', 'nigger', 'faggot'];

/** Endings a blocked word may have and still count ("bitches", "pissed", "wankers"). */
const ENDINGS = ['', 's', 'es', 'ed', 'd', 'er', 'ers', 'ing', 'in', 'y', 'ie', 'ies'];

/** Digits and symbols people use for letters. */
const LOOKALIKES = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i' };

const BLOCKED = new Set(WORDS);

/**
 * The blocked words in a piece of text, where they are (so the page can highlight them).
 * @param {string} text
 * @returns {{ word: string, start: number, end: number }[]}  start/end: indexes into text
 */
export function blockedWords(text) {
  if (typeof text !== 'string' || text === '') return [];
  const found = [];
  // A word: letters, digits and the symbols in LOOKALIKES (so "sh!t" and "a$$" stay one word).
  for (const match of text.matchAll(/[\p{L}\p{N}@$!]+/gu)) {
    // A "!" at the end is punctuation ("Wow!"), not a letter.
    const word = match[0].replace(/!+$/, '');
    if (word === '') continue;
    if (isBlocked(normalize(word))) found.push({ word, start: match.index, end: match.index + word.length });
  }
  return found;
}

function normalize(word) {
  return [...word.toLowerCase()].map((c) => LOOKALIKES[c] ?? c).join('');
}

function isBlocked(word) {
  // "fuuuck", "shiiit": a letter said three or more times counts once.
  const squeezed = word.replace(/(.)\1{2,}/g, '$1');
  for (const w of new Set([word, squeezed])) {
    if (ENDINGS.some((end) => w.endsWith(end) && BLOCKED.has(w.slice(0, w.length - end.length)))) return true;
    if (ROOTS.some((root) => w.includes(root))) return true;
  }
  return false;
}

/**
 * The blocked words in each field that has any, for an error the page can show.
 * @param {Record<string, string | null | undefined>} fields  e.g. { name, description }
 * @returns {{ field: string, text: string, words: { word: string, start: number, end: number }[] }[]}
 */
export function blockedFields(fields) {
  return Object.entries(fields)
    .map(([field, text]) => ({ field, text: text ?? '', words: blockedWords(text ?? '') }))
    .filter((f) => f.words.length > 0);
}

/** The error message for blocked fields: which words, in which field. */
export function blockedMessage(blocked) {
  const parts = blocked.map((f) => `${FIELD_NAMES[f.field] ?? f.field}: ${[...new Set(f.words.map((w) => `"${w.word}"`))].join(', ')}`);
  return `Some words can't be in a public game's name or description. Change them first (${parts.join('; ')}).`;
}

const FIELD_NAMES = { name: 'the name', description: 'the description' };

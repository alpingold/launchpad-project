/**
 * Blocked words (BUILD-PLAN Step 20, story 41): words the site refuses where text becomes public, in
 * a display name when it is chosen, and in a Game's title and description when it is published (and
 * a description changed while published).
 *
 * The list is short on purpose: slurs and the crudest words, the ones nobody could defend in a
 * title. It will miss deliberate misspellings and words run together; an admin's takedown is for
 * those. The owner edits this file to change it. Names and Games that already exist are not gone
 * back over. This repository is public, so the list is too.
 *
 * Matching is on whole words, so a harmless word that merely contains a blocked one passes (the
 * classic mistake: "Scunthorpe", "class", "cocktail"). Before matching, the text is folded: look-alike
 * forms made plain (a full-width letter becomes its ordinary one), accents removed, lower case. A
 * word is a run of letters: digits, underscores, spaces and punctuation all separate words, so
 * `x_word_99` holds the word "word". A blocked word with "s" added (a plural) is blocked too.
 */

/** The words, in lower case, without accents. */
export const BLOCKED_WORDS: readonly string[] = [
  // The crudest words.
  "cunt",
  "fuck",
  "fucked",
  "fucker",
  "fucking",
  "motherfucker",
  "twat",
  "whore",
  // Slurs.
  "beaner",
  "chink",
  "fag",
  "faggot",
  "gook",
  "kike",
  "nigga",
  "nigger",
  "raghead",
  "retard",
  "spic",
  "tranny",
  "wetback",
];

const BLOCKED = new Set(BLOCKED_WORDS);

/** The text's words, folded: plain forms, no accents, lower case, split at anything that isn't a letter. */
function words(text: string): string[] {
  return text
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word !== "");
}

/** The first blocked word in `text`, as the list has it, or undefined if there is none. */
export function blockedWordIn(text: string): string | undefined {
  for (const word of words(text)) {
    if (BLOCKED.has(word)) return word;
    if (word.endsWith("s") && BLOCKED.has(word.slice(0, -1))) return word.slice(0, -1);
  }
  return undefined;
}

/** What each refusal says: the word, and where it was, so the Creator knows what to change. */
export const refusals = {
  displayName: (word: string) => `That display name has a word the site doesn't allow: "${word}". Pick another.`,
  title: (word: string) => `The Game's title has a word the site doesn't allow: "${word}". Change the title in the Game's code, upload it as a new Version and publish that.`,
  description: (word: string) => `The description has a word the site doesn't allow: "${word}". Change it and try again.`,
} as const;

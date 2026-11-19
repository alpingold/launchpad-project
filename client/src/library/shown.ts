/**
 * What the Library page shows: its whole list, searched, filtered by how many people there are, and
 * sorted. The browser holds the whole list (at most a few hundred Games) and does this itself, so
 * the server needs no search code.
 */
import type { LibraryEntry } from "./library-api.js";

export type LibrarySort = "az" | "newest" | "played";

export interface LibraryChoice {
  /** Words to find in a title, a description or a Creator's name; empty for every Game. */
  readonly search: string;
  /** How many people want to play; null for any number. */
  readonly people: number | null;
  readonly sort: LibrarySort;
}

/** One fixed language and rule, so every browser sorts the titles in the same order. */
const titles = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Lower case, without accents: "Café" is found by "cafe". */
function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function matches(entry: LibraryEntry, words: readonly string[]): boolean {
  const haystack = plain(`${entry.title}\n${entry.description}\n${entry.creator ?? ""}`);
  return words.every((word) => haystack.includes(word));
}

const byTitle = (a: LibraryEntry, b: LibraryEntry) => titles.compare(a.title, b.title) || a.id.localeCompare(b.id);

const ORDERS: Readonly<Record<LibrarySort, (a: LibraryEntry, b: LibraryEntry) => number>> = {
  az: byTitle,
  // An Official game has no date: they came with the site, so they are the oldest.
  newest: (a, b) => (b.publishedAt ?? -Infinity) - (a.publishedAt ?? -Infinity) || byTitle(a, b),
  played: (a, b) => b.plays - a.plays || byTitle(a, b),
};

export function shown(entries: readonly LibraryEntry[], choice: LibraryChoice): LibraryEntry[] {
  const words = plain(choice.search).split(/\s+/).filter((word) => word !== "");
  const people = choice.people;
  return entries
    .filter((entry) => matches(entry, words))
    .filter((entry) => people === null || (entry.players.min <= people && people <= entry.players.max))
    .sort(ORDERS[choice.sort]);
}

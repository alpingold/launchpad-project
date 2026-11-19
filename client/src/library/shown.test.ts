import { describe, expect, test } from "vitest";
import { aboutPlays, playerCount, type LibraryEntry } from "./library-api.js";
import { shown, type LibraryChoice } from "./shown.js";

function entry(id: string, change: Partial<LibraryEntry> = {}): LibraryEntry {
  return { id, playId: id, title: id, players: { min: 2, max: 6 }, description: "", creator: "Ada", madeBy: "Uploaded", publishedAt: 100, plays: 0, ...change };
}

const ANY: LibraryChoice = { search: "", people: null, sort: "az" };
const ids = (entries: readonly LibraryEntry[]) => entries.map((e) => e.id);

describe("searching", () => {
  const entries = [
    entry("a", { title: "Café Rush" }),
    entry("b", { title: "Dots", description: "Connect the dots before the timer runs out." }),
    entry("c", { title: "Words", creator: "Zoë" }),
  ];

  test("finds words in a title, a description or a Creator's name, whatever their case or accents", () => {
    expect(ids(shown(entries, { ...ANY, search: "CAFE" }))).toEqual(["a"]);
    expect(ids(shown(entries, { ...ANY, search: "timer" }))).toEqual(["b"]);
    expect(ids(shown(entries, { ...ANY, search: "zoe" }))).toEqual(["c"]);
  });

  test("every word must be found, in any order; spaces alone find everything", () => {
    expect(ids(shown(entries, { ...ANY, search: "runs connect" }))).toEqual(["b"]);
    expect(ids(shown(entries, { ...ANY, search: "connect nothing" }))).toEqual([]);
    expect(ids(shown(entries, { ...ANY, search: "   " }))).toEqual(["a", "b", "c"]);
  });
});

test("how many of you are there: only Games that take exactly that many, ends included", () => {
  const entries = [entry("pair", { players: { min: 2, max: 2 } }), entry("crowd", { players: { min: 3, max: 8 } }), entry("solo", { players: { min: 1, max: 1 } })];
  expect(ids(shown(entries, { ...ANY, people: 2 }))).toEqual(["pair"]);
  expect(ids(shown(entries, { ...ANY, people: 3 }))).toEqual(["crowd"]);
  expect(ids(shown(entries, { ...ANY, people: 8 }))).toEqual(["crowd"]);
  expect(ids(shown(entries, { ...ANY, people: 9 }))).toEqual([]);
});

describe("sorting", () => {
  const entries = [
    entry("o1", { title: "Sum It Up", madeBy: "Official", creator: null, publishedAt: null, plays: 40 }),
    entry("u1", { title: "apple race", publishedAt: 300, plays: 3 }),
    entry("u2", { title: "Zebra", publishedAt: 500, plays: 40 }),
    entry("u3", { title: "Level 10", publishedAt: 200, plays: 0 }),
    entry("u4", { title: "Level 9", publishedAt: 200, plays: 0 }),
  ];

  test("A–Z: by title, ignoring case, with numbers in number order", () => {
    expect(ids(shown(entries, { ...ANY, sort: "az" }))).toEqual(["u1", "u4", "u3", "o1", "u2"]);
  });

  test("newest: by when the published Version was made; the Official games, which came with the site, last", () => {
    expect(ids(shown(entries, { ...ANY, sort: "newest" }))).toEqual(["u2", "u1", "u4", "u3", "o1"]);
  });

  test("most played: by counted plays; a tie by title", () => {
    expect(ids(shown(entries, { ...ANY, sort: "played" }))).toEqual(["o1", "u2", "u1", "u4", "u3"]);
  });

  test("the list it was given is left alone", () => {
    const before = ids(entries);
    shown(entries, { ...ANY, sort: "played" });
    expect(ids(entries)).toEqual(before);
  });
});

test("the words for plays and Players", () => {
  expect([0, 1, 2, 1234].map(aboutPlays)).toEqual(["Not played yet", "About 1 play", "About 2 plays", "About 1,234 plays"]);
  expect([playerCount({ min: 2, max: 6 }), playerCount({ min: 4, max: 4 }), playerCount({ min: 1, max: 1 })]).toEqual(["2 to 6 players", "4 players", "1 player"]);
});

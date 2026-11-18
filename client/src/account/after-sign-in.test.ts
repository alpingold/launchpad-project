// Where a visitor goes once signed in: back to the Creator's page they came from, and never to an
// address someone else put in a link.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { rememberWhereTo, takeWhereTo } from "./after-sign-in.js";

beforeEach(() => {
  const kept = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test("back to the Creator's page they were sent from, once", () => {
  rememberWhereTo("/my/games/AbC_d-9");
  expect(takeWhereTo()).toBe("/my/games/AbC_d-9");
  expect(takeWhereTo()).toBe("/");
});

test("nowhere but the site's own Creator pages: anything else is the home page", () => {
  for (const elsewhere of ["//evil.example/my/games", "https://evil.example/my/games", "/my/games/../../sign-out", "/my/games?x=1", "/sign-in", "javascript:alert(1)", "/my/games\\@evil", ""]) {
    rememberWhereTo(elsewhere);
    expect(takeWhereTo(), elsewhere).toBe("/");
  }
  rememberWhereTo(null);
  expect(takeWhereTo()).toBe("/");
});

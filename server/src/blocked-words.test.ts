// Blocked words: whole words, after folding, so harmless words that contain a blocked one pass.
import { expect, test } from "vitest";
import { BLOCKED_WORDS, blockedWordIn } from "./blocked-words.js";

test("a blocked word is found as a whole word, and named as the list has it", () => {
  expect(blockedWordIn("Fuck this game")).toBe("fuck");
  expect(blockedWordIn("a game about whores")).toBe("whore");
});

test("case, accents and look-alike forms don't hide it", () => {
  expect(blockedWordIn("FÜCK")).toBe("fuck");
  expect(blockedWordIn("ｆｕｃｋ")).toBe("fuck");
  expect(blockedWordIn("Twät")).toBe("twat");
});

test("digits, underscores and punctuation separate words, so a name like x_word_99 is caught", () => {
  expect(blockedWordIn("x_fuck_99")).toBe("fuck");
  expect(blockedWordIn("cunt.exe")).toBe("cunt");
  expect(blockedWordIn("2fuck2")).toBe("fuck");
});

test("a harmless word that merely contains a blocked one passes: the classic mistake isn't made", () => {
  for (const harmless of ["Scunthorpe United", "Spice Rack", "Specific Gravity", "Fire Retardant", "Chinking Glasses", "Spicy Tacos", "Fagin's Gang", "Shitake"]) {
    expect(blockedWordIn(harmless), harmless).toBeUndefined();
  }
});

test("words run together with others are not caught (an admin's takedown is for those)", () => {
  expect(blockedWordIn("fuckface")).toBeUndefined();
});

test("ordinary text passes", () => {
  expect(blockedWordIn("Sum It Up: write one word, then vote for the best")).toBeUndefined();
  expect(blockedWordIn("")).toBeUndefined();
});

test("the list is short, in lower case, without accents, and each is found", () => {
  expect(BLOCKED_WORDS.length).toBeLessThanOrEqual(40);
  for (const word of BLOCKED_WORDS) {
    expect(word).toMatch(/^[a-z]+$/);
    expect(blockedWordIn(`A ${word}!`)).toBe(word);
  }
});

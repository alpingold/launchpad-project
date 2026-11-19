// The development fake answers the maker's prompts with canned answers (dev-fake.ts): it must make
// a real change to a file it is asked to change, even one it changed before, and give back a file
// it is asked to fix as it is.
import { expect, test } from "vitest";
import { fixMessages, revisionMessages } from "./build.js";
import { FAKE_CHANGED, fakeAnswer } from "./dev-fake.js";
import { longestCodeBlock } from "./model.js";

test("a Revision adds a line saying what was asked, even to a file it changed before", () => {
  const once = longestCodeBlock(fakeAnswer(revisionMessages(undefined, "// the Game\n", "Make it red."))) ?? "";
  expect(once).toBe(`${FAKE_CHANGED}Make it red.\n// the Game\n`);
  const twice = longestCodeBlock(fakeAnswer(revisionMessages(undefined, once, "Now blue."))) ?? "";
  expect(twice).toBe(`${FAKE_CHANGED}Now blue.\n${once}`);
});

test("a fix is answered with the file as it was sent", () => {
  const context = "The Creator asked for this change to their Game:\nMake it red.";
  const file = `${FAKE_CHANGED}Make it red.\n// the Game\n`;
  expect(longestCodeBlock(fakeAnswer(fixMessages(context, file, [{ stage: "types", message: "x" }], false)))).toBe(file);
});

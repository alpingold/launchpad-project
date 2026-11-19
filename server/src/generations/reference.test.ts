// The site's own AI and the page for Creators' own AIs (/make) read one reference text: the same
// rules with the same limits, and the same SDK types. What /make's prompt says and what the server's
// text says are compared as they come out, so either side drifting from the SDK's text fails here.
import { expect, test } from "vitest";
import { promptText, SDK_TYPES as typesOnTheClient } from "../../../client/src/make/rules.js";
import { GAME_LIMITS } from "../games.js";
import { playtestText, rulesText, typesText } from "./reference.js";

/** /make's prompt, as a Creator copies it, with the site's own limits. */
const makePrompt = promptText(GAME_LIMITS, typesOnTheClient);

test("the SDK types the server sends are the ones /make's prompt holds", () => {
  expect(typesText()).toContain("export declare function defineGame<");
  expect(makePrompt).toContain(typesText());
});

test("the rules and the Playtest's checks the server sends are, line for line, the ones /make's prompt holds, with the site's own limits", () => {
  for (const line of [...rulesText().split("\n"), ...playtestText().split("\n")]) expect(makePrompt).toContain(line);
  expect(rulesText()).toContain(`${GAME_LIMITS.maxSourceBytes / 1024} KB`);
});

test("the server leaves out only /make's line about a Creator's own Uploads", () => {
  expect(playtestText()).not.toContain("times an hour");
  expect(makePrompt).toContain(`You can upload ${GAME_LIMITS.uploadsPerHour} times an hour`);
  expect(playtestText().split("\n")).toHaveLength(3);
});

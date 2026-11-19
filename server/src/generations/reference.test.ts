// The site's own AI and the page for Creators' own AIs (/make) read one reference text: the same
// rules with the same limits, and the same SDK types, byte for byte.
import { fileRules as sdkRules, SDK_TYPES as sdkTypes } from "@boilergames/sdk/v1/reference";
import { expect, test } from "vitest";
import { fileRules as clientRules, SDK_TYPES as clientTypes } from "../../../client/src/make/rules.js";
import { GAME_LIMITS } from "../games.js";
import { rulesText, typesText } from "./reference.js";

test("the server and the client get the same SDK types text, from the SDK", () => {
  expect(clientTypes).toBe(sdkTypes);
  expect(typesText()).toBe(sdkTypes.trim());
  expect(typesText()).toContain("export declare function defineGame<");
});

test("the server and the client get the same rules, with the site's own limits", () => {
  expect(clientRules(GAME_LIMITS)).toEqual(sdkRules(GAME_LIMITS));
  for (const rule of sdkRules(GAME_LIMITS)) expect(rulesText()).toContain(rule);
  expect(rulesText()).toContain(`${GAME_LIMITS.maxSourceBytes / 1024} KB`);
});

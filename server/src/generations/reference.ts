/**
 * The reference text the site's own AI is given in every Build prompt: the rules a Game's file must
 * follow and the SDK's types. It comes from the SDK's reference text (`@boilergames/sdk/v1/reference`),
 * the same one the page for Creators' own AIs shows (/make), with the site's own limits, so the two
 * can never disagree.
 */
import { checkSteps, fileRules, SDK_TYPES } from "@boilergames/sdk/v1/reference";
import { GAME_LIMITS } from "../games.js";

/** The rules a file must follow, with the site's limits, one per line. */
export function rulesText(): string {
  return fileRules(GAME_LIMITS)
    .map((rule) => `- ${rule}`)
    .join("\n");
}

/**
 * What the Playtest does with the file, one step per line: the checks, without /make's last step,
 * which is about a Creator's own Uploads (how many an hour) and means nothing to a Build.
 */
export function playtestText(): string {
  return checkSteps(GAME_LIMITS)
    .map((step) => `- ${step}`)
    .join("\n");
}

/** The SDK's types, everything `@boilergames/sdk/v1` offers, as declarations. */
export function typesText(): string {
  return SDK_TYPES.trim();
}

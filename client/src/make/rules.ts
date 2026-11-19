/**
 * The ready-made prompt on the page that tells Creators how to write a Game with any AI or by hand
 * (/make). The rules and the SDK's types come from the SDK's reference text, the one home they share
 * with the site's own AI (`@boilergames/sdk/v1/reference`).
 */
import { fileRules, playtestSteps, type GameLimits } from "@boilergames/sdk/v1/reference";

export { fileRules, playtestSteps, SDK_TYPES, type GameLimits } from "@boilergames/sdk/v1/reference";

/** Where the Creator's idea goes in the prompt. */
export const IDEA_PLACEHOLDER = "[Describe your Game here: what the Players do on their phones, what the Screen shows, and how it ends.]";

/**
 * The ready-made prompt: what the Game is for, the rules, the SDK's types and a place for the
 * Creator's idea. No example Game: an example is what every Game then copies (the owner's rule for
 * the site's own AI, which holds here too).
 */
export function promptText(limits: GameLimits, sdkTypes: string): string {
  return [
    "Write a party game for BoilerGames, a site where a group plays on one shared screen (the Screen) and each Player uses their own phone (the Controller).",
    "",
    "The rules the file must follow (the site checks every one):",
    ...fileRules(limits).map((rule) => `- ${rule}`),
    "",
    "What the site does with the file:",
    ...playtestSteps(limits).map((step) => `- ${step}`),
    "",
    'Here are the SDK\'s types, everything "@boilergames/sdk/v1" offers. Use only these:',
    "",
    "```ts",
    sdkTypes.trim(),
    "```",
    "",
    "My idea for the Game:",
    IDEA_PLACEHOLDER,
    "",
    "Answer with the whole file, in one TypeScript code block.",
  ].join("\n");
}

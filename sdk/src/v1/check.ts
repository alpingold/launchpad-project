// What the site imports to check a View, a Look or an Action: `@boilergames/sdk/v1/check`.
// Kept apart from `@boilergames/sdk/v1` (what a Game imports) so Games don't carry the checkers,
// and apart from the Engine so the phone page can check a View without loading the Engine.
export * from "./validate.js";
export * from "./offers.js";

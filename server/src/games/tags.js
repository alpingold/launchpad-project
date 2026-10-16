// The tags a game may give itself in its game-info block (plan §14). A fixed list, so the
// catalogue's filters stay useful: the AI can't invent "platforming" next to "platformer".
// To add a tag: add it here AND to the list in generator/spec/GAME_SPEC.md (a test checks
// that they match).

export const GAME_TAGS = [
  'action',
  'racing',
  'platformer',
  'adventure',
  'rpg',
  'board',
  'strategy',
  'puzzle',
  'drawing',
  'words',
  'trivia',
  'voting',
  'bluffing',
  'co-op',
  'teams',
  'minigame',
];

/** At most this many tags per game. */
export const MAX_GAME_TAGS = 4;

/** The longest a game may say it lasts, in minutes. */
export const MAX_GAME_MINUTES = 180;

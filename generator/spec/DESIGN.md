# Writing a game design

A design is the plan for a game, written before any code, so a person can check the idea
before it's built. It uses exactly these headings, in this order. Be concrete: numbers, not
"some"; what the screen shows, not "a nice screen". Lists and short sentences, but complete
ones. Usually 800–1,500 words, at most about 1,800: enough that someone could build the game
without guessing.

Keep what the idea asks for: team or competitive, the roles, the places and things it names,
how it plays. If something can't work on a big screen and phones, change as little as you can
and say what you changed under Genre and feel.

# <the game's name>

## Genre and feel
One or two sentences: what kind of game, and how it should feel to play. Then the one moment
players will talk about afterwards.

## Players
`min–max` players, and how the game changes with few or many.

## Big screen
What the room sees, phase by phase: the scene, the board or world, scores, timers, whose turn
it is, and what changes on screen when something happens.

## Phones
What each phone shows and its controls, phase by phase. Name the `party.ui` pieces used.

## Secrets
What only some players may know: roles, secret words, cards, answers or picks before their
reveal. For each one: who knows it, and when (if ever) the big screen reveals it. Until
then the big screen shows at most that someone has done something ("Ana locked in"), never
what, and no hint of it either (a colour, an icon, the order of a list). Or `none`.

## Rules
Step by step, from the start to the end, with numbers: timers, points, speeds, health.
- **Choices:** in every phase each player has a choice that matters, with a trade-off (risk
  or safety, now or later, help or hurt someone). Players affect each other, not only the board.
- **Over the game:** what changes from round to round (a new twist, a harder level, a bigger
  prize), and how the end builds to a finish. Enough rounds, levels or turns that the lead can
  change hands. A game that's one loop repeated the same way is too thin.
- **Talking:** if players discuss, accuse or persuade, that talk gets its own timer (30–90 s).

## Ending and winner
When the game ends, who wins, and how ties are handled. Rankings for `party.end`.

## Length
How long one round (or level, or turn) takes, and how long the whole game takes, worked out
from the numbers above: show the arithmetic (distance ÷ speed, timers × rounds, countdowns
and pauses). For example: "a round: 100 tiles ÷ 6 tiles/s ≈ 17 s, ≈ 25 s with jumps;
3 rounds + 5 s countdowns + 6 s final screen ≈ 1.5–2 min." Longer comes from more to do,
never from waiting.

## Art
This game's own look, so it doesn't look like every other game:
- **Palette and background:** 3–5 colours (hex), and the scene everything sits on, with its
  details (a station's grid and hull, a kitchen's tiles and shelves), not a plain colour.
- **Style:** the shape language, e.g. "soft blobs and rounded tiles", "sharp neon lines on
  black", "paper cards with thick ink outlines", "chunky pixel blocks".
- **The players and the main things:** drawn as characters or objects with a few features
  (a helmet with a visor, a fish with fins and eyes, a chef's hat), not plain circles or
  boxes; how players are told apart; the goal and the dangers.
- **Each phase:** how the screen looks different from phase to phase.
- **The big moment:** one thing the room will remember seeing (doors sliding open, a dish
  lifted from under a cloche), and exactly how it moves.
- **Motion:** what moves, pops, shakes or glows, and when.
- **Sound:** which `party.sound` plays at which moments (a point, a buzzer, the winner).
It's drawn with shapes on a canvas, HTML and CSS, or pictures from the art library.

## Edge cases
- A player leaves, or comes back.
- Nobody does anything (every wait has a timer).
- 1 player, and the most players.
- The big screen reloads (what's saved with `party.save`).

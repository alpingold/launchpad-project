# Writing a game design

A design is a short plan for a game, written before any code, so a person can check the
idea before it's built. It uses exactly these headings, in this order. Be concrete: numbers,
not "some"; what the screen shows, not "a nice screen". Short sentences and lists. At most
about 600 words.

# <the game's name>

## Genre and feel
One or two sentences: what kind of game, and how it should feel to play.

## Players
`min–max` players, and how the game changes with few or many.

## Big screen
What the room sees, part by part: the world or board, scores, timers, whose turn it is.

## Phones
What each phone shows and its controls, phase by phase. Name the `party.ui` pieces used.

## Secrets
What only some players may know: roles, secret words, cards, answers or picks before their
reveal. For each one: who knows it, and when (if ever) the big screen reveals it. Until
then the big screen shows at most that someone has done something ("Ana locked in"), never
what, and no hint of it either (a colour, an icon, the order of a list). Or `none`.

## Rules
Step by step, from the start to the end, with numbers: timers, points, speeds, health.

## Ending and winner
When the game ends, who wins, and how ties are handled. Rankings for `party.end`.

## Length
How long one round (or level, or turn) takes, and how long the whole game takes, worked out
from the numbers above: show the arithmetic (distance ÷ speed, timers × rounds, countdowns
and pauses). For example: "a round: 100 tiles ÷ 6 tiles/s ≈ 17 s, ≈ 25 s with jumps;
3 rounds + 5 s countdowns + 6 s final screen ≈ 1.5–2 min." Aim for 5–15 minutes unless
the idea asks for a length; if your total is outside that, change the design (more rounds,
longer levels, more to do) instead of just reporting it.

## Art
This game's own look, so it doesn't look like every other game:
- **Palette and background:** 3–5 colours and what the scene sits on.
- **Style:** the shape language, e.g. "soft blobs and rounded tiles", "sharp neon lines on
  black", "paper cards with thick ink outlines", "chunky pixel blocks".
- **The main things:** how the players, the goal and the dangers look, and how players are
  told apart.
- **Motion:** what moves, pops, shakes or glows, and when.
It's drawn with shapes on a canvas, HTML and CSS, or pictures from the art library.

## Closest example
One of: `bumper-blobs` (real-time canvas with a joystick), or `none`. Then one sentence on
why.

## Edge cases
- A player leaves, or comes back.
- Nobody does anything (every wait has a timer).
- 1 player, and the most players.
- The big screen reloads (what's saved with `party.save`).

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

## Rules
Step by step, from the start to the end, with numbers: timers, points, speeds, health.

## Ending and winner
When the game ends, who wins, and how ties are handled. Rankings for `party.end`.

## Length
How long one round (or level, or turn) takes, and how long the whole game takes, worked out
from the numbers above: show the arithmetic (distance ÷ speed, timers × rounds, countdowns
and pauses). For example: "a round: 100 tiles ÷ 6 tiles/s ≈ 17 s, ≈ 25 s with jumps;
3 rounds + 5 s countdowns + 6 s final screen ≈ 1.5–2 min." If the idea asks for a length,
match it.

## Art
How things are drawn: canvas shapes, text characters (`party.ui.ascii`), HTML and CSS, or
pictures from the art library.

## Template
One of: `rounds` (everyone answers at once, reveal, next round), `realtime` (the big screen
runs a world 60 times a second; phones steer), `turns` (one player acts at a time), or
`none`. Then one sentence on why.

## Closest example
One of: `bumper-blobs` (real-time canvas), `tower-dash` (ASCII platformer),
`dungeon-party` (turn-based ASCII RPG with votes), or `none`. Then one sentence on why.

## Edge cases
- A player leaves, or comes back.
- Nobody does anything (every wait has a timer).
- 1 player, and the most players.
- The big screen reloads (what's saved with `party.save`).

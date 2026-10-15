# Tower Dash

## Genre and feel
A racing platformer drawn in text characters: run, jump over spikes, grab coins, reach the
exit first. Fast, a bit frantic, readable from across the room.

## Players
1–8. Alone it's a time trial; with more it's a race where everyone shares the level.

## Big screen
- The level as text characters with `party.ui.ascii`: `#` walls, `=` platforms you can jump
  up through, `^` spikes, `$` coins, `>` the exit.
- Each player is the first letter of their name, in their colour.
- The level name, a 120 s timer, and the points table on the right.

## Phones
- "A is you" with the letter in the player's colour, the goal for this level, and coins,
  distance to the exit and points.
- `party.ui.gamepad` with ◀ ▶ and a big **Jump** button at the bottom.

## Rules
1. 3 levels. Everyone starts at `S`.
2. Run 7 tiles/s; jump about 2.6 tiles high and 4.8 across; a short grace time to jump just
   after running off an edge.
3. Spikes send you back to the start of the level. Coins are worth 1 point each, once.
4. Reaching `>`: 5, 3 and 2 points for the first three, 1 for anyone else.
5. A level ends when everyone is out, 30 s after the first player is out, or after 120 s.
6. 4 s between levels showing who finished.

## Ending and winner
After level 3, most points wins; ties share a place. A 6 s final screen, then `party.end`.

## Length
- A level: about 44 tiles from `S` to `>` ÷ 7 tiles/s ≈ 6 s of straight running; with jumps,
  spikes and coins, 10–20 s for the leader. The rest have at most 30 s more (120 s at most).
- The game: 3 levels + 4 s between them + a 6 s final screen ≈ 1–2 min. Short: a warm-up
  game. Longer levels or more of them would make it last.

## Art
Text characters only, with `party.ui.ascii` and a colour per character.

## Template
`realtime`: physics on the big screen every frame; phones hold buttons.

## Closest example
`none`: this is the platformer example itself.

## Edge cases
- A player who leaves stops moving; the level timer still ends the level.
- Nobody moves: the 120 s limit ends each level.
- 1 player plays a time trial; 8 players start stacked at `S` (players don't collide).
- Big screen reload: points and the level are saved; the level restarts.

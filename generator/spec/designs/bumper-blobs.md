# Bumper Blobs

## Genre and feel
A real-time party brawler on ice: chaotic, slippery and quick. Rounds last under a minute.

## Players
2–12. With few players the ice feels huge; with many it's a scramble from the first second.

## Big screen
- A round sheet of ice on dark water, drawn on a canvas, filling the screen.
- Each blob is a circle in its player's colour with their name under it.
- A "3, 2, 1, GO!" countdown, "Round 2 of 3", and everyone's wins along the top.
- A blob that falls off shrinks into the water.

## Phones
- The player's colour and name at the top, and a status line ("Bump them off!", "You fell in!").
- `party.ui.joystick` to steer, and a big **Dash** button below it (a short burst of speed,
  then 1.6 s to cool down, shown by the button fading back in).
- Wins so far.

## Rules
1. Each round: blobs start evenly spaced on a circle around the middle; 3 s countdown; then go.
2. The joystick accelerates the blob (ice: it keeps sliding, losing half its speed per
   second with no input). Top speed is capped.
3. Blobs that touch bounce apart, a little harder than a fair collision.
4. A blob whose centre leaves the ice falls in and is out for the round.
5. After 20 s the ice starts to melt from the edge, so every round ends.
6. The last blob on the ice wins the round. 3 rounds.

## Ending and winner
After 3 rounds, the most round wins wins; ties share a place. Rankings by wins. A 5 s final
screen, then `party.end`.

## Art
Canvas: circles, an ice disc with a soft edge, water. No pictures.

## Template
`realtime`: the big screen runs physics every frame and phones steer.

## Closest example
`none`: this is the real-time example itself.

## Edge cases
- A player who leaves stops steering; their blob just slides.
- Nobody moves: the melting ice ends the round anyway.
- 2 players up to 12: the start spots are spread evenly on the circle for any number.
- Big screen reload: wins and the round number are saved; a round that was cut off starts again.

# Claim Jumpers

## Genre and feel
A short simultaneous-move board game about a gold rush. The board is a surveyor's map on the
big screen; every turn **everyone secretly picks one square at the same time** on their phone,
then the TV reveals all the moves at once: new claims pop up, a jumped claim flips colour, and
two prospectors who picked the same square bounce off each other. Nobody ever waits for anyone
else's turn, and the reveal is the moment the room reacts to ("you took MY gold?!").

## Players
2–6 (`minPlayers` 2, `maxPlayers` 6). The board grows with the room so it stays crowded:
- 2 players: 6 × 6 · 3–4 players: 7 × 7 · 5–6 players: 8 × 8.

Why not more than 6: the phone shows the whole board, and an 8 × 8 board is the largest whose
squares are still a comfortable tap (about 44 px on a 390 px phone). Each player also needs a
shape that tells them apart without colour (see Art), and six shapes read clearly.

## Rules
1. **Camps.** Each player starts with one square, their **camp**, spread evenly around the
   ring one square in from the edge (random seat order). A camp can never be taken, so
   nobody is ever knocked out of the game.
2. **Gold.** A few squares near the middle hold a gold nugget: 2 on 6 × 6 (the two centre
   squares between the camps), 5 on 7 × 7 (a plus in the centre), 8 on 8 × 8 (the centre four
   and four around them). Gold is placed symmetrically around the centre and never on the camp
   ring, so no camp starts on or right next to it.
3. **A turn (20 s):** every player picks one square on their phone:
   - an **empty** square next to (up, down, left, right) a square they own: a **claim**;
   - a square **another player owns** (not a camp) that touches theirs **on 2 or more sides**:
     a **jump** (you take it from them).
   The phone only lets you tap these. You can change your pick until time's up. The turn ends
   early when every connected player has picked. No pick: you skip the turn.
4. **The reveal (all at once).** Everything is judged on the board as it was at the start of
   the turn, so the order of the picks never matters:
   - **One player picked a square:** they get it (claim or jump).
   - **Two or more picked the same square:** a **clash**. Nobody gets it; it stays as it was.
5. **15 turns.** Then the game ends.

## Ending and winner
Score = 1 point per square you own, +2 more for each gold square (a gold square is worth 3).
Most points wins. Ties: more gold first, then shared place in seat order. `party.end` gets
everyone ranked by score; scores are the points.

## Big screen
- **The board** fills the height, centred: land squares, each owned square in its owner's
  colour with their shape on it, camps with a thick ring and a bigger shape, gold nuggets.
- **The side panel:** each player as a row (shape, colour, name, points, gold count), sorted by
  points. During a pick, a ✓ appears on a row when that player has picked (never where).
- **Top:** "Turn 4 of 15" and a timer bar.
- **Intro (10 s):** the title and four rules, each one short line with a tiny picture.
- **Reveal (about 4 s):** claims pop in, jumps flip like a turned tile with a little shake,
  clashes burst with a red ✕ and the clashing players' colours. A line under the board sums it
  up: "5 claims · 1 jump · 2 clashes".
- **End (12 s):** the final board, the ranking with the winner's row in gold, then `party.end`.

## Phones
- **Top:** your shape in your colour, your name, your points. "Turn 4 of 15", a timer bar.
- **The board:** the whole board (the same as the TV, so you can plan without looking up),
  with the squares you can pick glowing: claims with a white outline, jumps with a red dashed
  outline. Tap one to pick it (it fills with your shape); tap another to change.
- **Under the board:** one short line for what to do now ("Pick a square", "Picked. You can
  change it until time's up", "No square you can reach: you skip this turn").
- **After a reveal:** what happened to you, in a few words: "You claimed a square", "You
  jumped Ben's square!", "Clash with Ana: nobody got it", "Cal jumped one of yours".
- A `tap` sound when you pick. Nothing secret is lost by sound: it doesn't say which square.

## Length
- Intro 10 s, then 15 turns × (up to 20 s picking, usually 8–15 s since a turn ends when
  everyone has picked, + 4 s reveal), then 12 s at the end.
- ≈ 15 × 12–24 s + 22 s ≈ **3.5–6.5 min**; a careful group that uses the whole timer, 6.5.
  Short on purpose: it's a game to play two or three times in a row. `minutes` = [4, 7].

## Art
- **Palette (the same in both themes: it's the map):** deep map teal `#123238` with faint
  contour lines, land `#6f8f6a` (squares) on darker grid lines `#0d262b`, gold `#ffcc33`
  with a dark outline, a jump red `#ff4d5e`, paper text `#f3efe2`.
- **Player colours and shapes**, chosen so the colours stay apart for common colour
  blindness AND every player has a shape: orange `#ff8a1f` circle, sky blue `#3db8ff` square,
  pink `#ff5fa2` triangle, yellow-green `#b8e02e` diamond, violet `#a77bff` star, white
  `#f1f1f1` plus. The shape is drawn in dark ink on the owner's colour.
- **Style:** a hand-surveyed map: a slow contour-line background on canvas, square tiles
  with rounded corners, chunky shapes, no fine detail.
- **Motion:** claims pop (scale up with an overshoot), jumps flip, clashes shake with a red
  burst; the leader's row in the side panel glows gold.
- **Sound (big screen):** `tick` in the last 5 s, `pop` per claim, `coin` if gold was taken,
  `buzz` for a clash, a short swoop (`sound({ notes: [300, 600], ms: 90, type: 'square' })`)
  for a jump, `win` at the end.
- Canvas for the background contour lines; HTML and CSS for the board, shapes and panel
  (CSS `clip-path` makes the shapes).

## Closest example
`none`: Bumper Blobs is real-time and Stowaways is phases and secrets. This one is a shared
board with simultaneous secret moves.

## Edge cases
- **A player leaves:** they skip turns (the turn doesn't wait for them); their squares stay
  and can be jumped. Back: their phone redraws from its state.
- **No legal square:** the phone says so and that player counts as done for the early end.
- **Nobody picks:** the 20 s timer ends the turn; nothing changes.
- **A phone sends something odd:** a pick must be an integer square that is legal for that
  player this turn, during a pick; anything else is ignored.
- **Big-screen reload:** everything (board owners, camps, gold, turn, phase and its end time
  as a server time, the picks, the last reveal) is one plain-JSON object saved after every
  change. A cut-off pick resumes with its deadline; a cut-off reveal just finishes.

## Why these choices
- **Simultaneous picks, not turns:** with 6 players, taking turns would mean watching 5 other
  people move. Here everyone is busy at once, and the reveal is a shared moment.
- **Clash = nobody gets it:** the simplest rule you can see at a glance, and it makes the gold
  squares a bluffing game ("everyone will go for the gold, so I won't... or will they?").
- **Jumps need 2 sides:** without stealing, the board fills by turn 8 and the rest is dull;
  with free stealing it's chaos. "Touch it on 2 sides" is easy to see on the map and rewards
  building solid land instead of long thin lines.
- **Camps are safe:** being wiped out at a party is no fun, and you always have a way back in.
- **Judged on the start-of-turn board:** so no player's move depends on whose phone sent first
  (simultaneous really means simultaneous).

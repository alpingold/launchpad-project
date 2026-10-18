# Claim Jumpers

## Genre and feel
A gold-rush game of blind bids. Each round a few claims are staked out on the big screen's
map, each worth some gold. Everyone **secretly** spreads their prospectors over the claims on
their phone, then the TV reveals the claims one at a time: crews march in, the biggest crew
takes the gold, and if two crews tie for biggest the claim is **jumped** and nobody gets it.
Every round is a read on the room: pile up on the big claim, or slip a small crew onto the
one everyone forgot? The reveal is the moment the room reacts ("you put FOUR on that?!").

## Players
2–6 (`minPlayers` 2, `maxPlayers` 6).
- Claims per round: players + 1 (3 with two players, 7 with six), so there's always more gold
  than anyone can cover.
- Why it works with two: splitting a fixed crew over prizes is a classic two-player mind game
  ("Colonel Blotto"). Each round you're guessing where your rival will commit.
- Why not more than 6: seven claims are the most that fit in one row on the TV and in one
  list on a phone.

## Big screen
- **Top:** "Claim Jumpers", a timer bar while planning, and "Round 3 of 7" ("MOTHER LODE" on
  the last).
- **The claims:** a row of land plots on the map, each with two stakes, "Claim B", and its
  gold ("4"; "?" for the mystery claim until it's revealed).
- **The side panel:** each player as a row (shape, colour, name, a stick of dynamite while
  they still have it, gold), sorted by gold. While planning, a ✓ once they've locked in
  (never where they sent anyone).
- **Intro (12 s):** the title and the five rules, one short line each with an icon.
- **Reveal (about 1.7 s per claim):** claim by claim, the crews march in as rows (each
  player's shape chip and count, biggest first; the side panel has the names); the winner's plot glows gold with "Ana +4"; a jump shakes with
  a red burst and "CLAIM JUMPED! Nobody gets it"; dynamite greys the plot out with "BOOM!
  Ben blew it up". The "?" shows its value when its turn comes. The side panel keeps the
  scores from before the round until the reveal is over.
- **Scores (5 s):** the side panel with each player's "+N", and "Best round: Cal (+8)".
- **End (12 s):** the winner, their gold, then `party.end`.

## Phones
- **Top:** your shape in your colour, your name, your gold.
- **Planning:** "Round 3 of 7: send your crew", the timer, and your prospectors as little
  figures in your colour ("2 of 5 left"). Then a row per claim: its gold, "Claim B", a
  **− count +** stepper, and a dynamite button (while you have it). Big **Lock in** at the
  bottom ("Lock in (sit this one out)" with nobody sent). After locking: "Locked in ✓", and
  nothing can change.
- Every change is sent as a draft, so if time runs out before you lock in, your plan still counts.
- **Reveal:** "Look up!"
- **Scores:** "+4 gold this round" and a line per claim you were part of: "You took Claim B:
  +4 gold!", "Claim A was jumped: you tied with Ben.", "Cal outbid you on Claim C.", "You
  blew up Claim D.", "Ben blew up Claim D under your crew."
- **End:** "You win!" / "You tied for 1st!" / "You came 3rd", and your gold.

## Secrets
- **Each plan:** only its player's phone, until the reveal. The big screen shows only a ✓
  when someone locks in. The phones' `tap` sound doesn't say which claim.
- **The "?" claim's value:** nobody, until its turn in the reveal.

## Rules
1. **A round:** players + 1 claims, each worth 1–5 gold (random), plus one of them is a **"?"**
   worth 0–8, shown only at the reveal.
2. **Planning (25 s):** each player has **5 prospectors** to place on any claims (any split,
   or none). Ends early when every connected player has locked in.
3. **Catch-up:** the player(s) in last place get a **6th prospector** that round (not when
   everyone is tied).
4. **The reveal:** the biggest crew on a claim takes all its gold. A **tie for biggest** is a
   claim jump: nobody gets it. Smaller crews get nothing.
5. **Dynamite:** each player has one stick for the whole game. Put it on a claim (never one
   you send prospectors to) and nobody gets that claim, whoever went there.
6. **7 rounds.** The last is the **Mother Lode**: every claim's gold is doubled (the "?" up to 16).

## Ending and winner
Most gold wins. Ties: more claims won, then a shared place. `party.end` ranks everyone; scores
are their gold.

## Length
Intro 12 s, then 7 rounds × (up to 25 s planning, usually 10–20 s since it ends when everyone
has locked in, + reveal ≈ 1.7 s × claims + 1.8 s, + 5 s scores), then 12 s at the end.
- 2 players (3 claims): 7 × (15–25 + 7 + 5) s ≈ 3.2–4.4 min + 24 s ≈ **4–5 min**.
- 6 players (7 claims): 7 × (15–25 + 14 + 5) s ≈ 4–5.2 min + 24 s ≈ **4.5–6 min**.
- Short on purpose: a game to play two or three times in a row. `minutes` = [4, 7].

## Art
- **Palette (it's the map):** deep map teal `#123238` with faint contour lines, land plots
  `#6f8f6a` with wooden stakes, gold `#ffcc33` nuggets, jump red `#ff4d5e`, paper text `#f3efe2`.
- **Player colours and shapes**, so colour blindness never hides whose crew is whose: orange
  `#ff8a1f` circle, sky blue `#3db8ff` square, pink `#ff5fa2` triangle, yellow-green `#b8e02e`
  diamond, violet `#a77bff` star, white `#f1f1f1` plus. The shape is drawn in dark ink on
  the owner's colour.
- **Motion:** plots tilt a degree or two; crews march in with a little overshoot; the winner
  glows; a jump shakes with a red burst; dynamite flashes and greys the plot.
- **Sound (big screen):** `tick` in the last 5 s, `coin` per won claim, `buzz` for a jump, a
  low boom (`sound({ notes: [140, 70, 50], ms: 160, type: 'sawtooth' })`) for dynamite, `go`
  for the Mother Lode, `win` at the end. Phones: `tap` on each change.
- Canvas for the background contour lines; HTML and CSS for the plots, crews and panel
  (CSS `clip-path` makes the shapes and nuggets).

## Closest example
`none`: Ballpark is guesses and bets on numbers; this is hidden allocation over prizes.

## Edge cases
- **A player leaves:** the round doesn't wait for them; a draft they sent still counts. Back:
  their phone redraws from its state.
- **Nobody sends anyone:** every claim says "Nobody came"; the game goes on.
- **A phone sends something odd:** a plan must have one whole number per claim, add up to at
  most that player's crew, and put dynamite only where they have none of their own (and only
  if they still have it); anything else is ignored. Nothing is accepted after locking in.
- **Big-screen reload:** everything (round, phase and its end time as a server time, the
  claims, plans, locks, crews, dynamite left, gold, claims won, the last results) is one
  plain-JSON object saved after every change. A cut-off plan resumes with its deadline; a
  cut-off reveal shows the claims already revealed and carries on.

## Why these choices
- **Blind bids instead of a board:** the old board version (pick a square each turn) left two
  players expanding into empty land without ever meeting, and the best move was nearly always
  obvious. Here every round has a real choice (spread or pile up) and every claim is contested.
- **Tie = nobody:** the simplest rule to see at a glance, and it turns the big claim into a
  bluff: "everyone will go for the 5, so I'll put 3 there... or will they?"
- **Dynamite once:** the answer to a rival going all-in, and a threat that hangs over every
  round until it's used.
- **The "?" claim:** a gamble each round, and a small reveal of its own.
- **Catch-up and the Mother Lode:** whoever is behind gets a little help, and the last round
  can still turn the game.

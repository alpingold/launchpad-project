# Stowaways

## Genre and feel
A hidden-role party game on a space station: most of the crew are human, one to three are
aliens in disguise. Small tests on the phones, answers on the big screen, and the room
arguing out loud about whose answer was "off". Tense, loud and funny: the phone keeps your
secret, the TV is the evidence board.

## Players
4–10 (`minPlayers` 4, `maxPlayers` 10).
- Aliens: 1 with 4–5 players, 2 with 6–8, 3 with 9–10. Everyone is told how many aliens are aboard.
- With 2+ aliens, the aliens' phones show who the other aliens are.
- Hacks: 2 per alien (2 at 4–5 players, 4 at 6–8, 6 at 9–10).
- Players per test: 2 at 4–5 players, 3 at 6–8, 4 at 9–10.

## Big screen
- **Always:** the station clock (big, top centre; red and ticking in the last 60 s), "Aliens aboard: 2",
  and the crew strip along the bottom: each player a capsule in their colour with their name, a
  gold star on the captain, a small button icon while they still have their button.
- **Roles:** "Check your phone. Tap to see your role." for 10 s. Nothing secret, ever.
- **Captain picks:** "Captain Sam is choosing a test." The chosen test and players light up when locked.
- **Test:** the tested players' capsules in the middle, a test timer, a tick as each one answers.
  The prompt is **not** shown (it would tell the aliens what the humans got).
- **Reveal:** the human prompt, then the answers dealt in one by one as cards with the
  player's name (text, drawing with `party.ui.drawing`, or a dot on an agree–disagree
  scale), then "Discuss!" with a 60 s bar.
- **Button:** the screen flashes red, "Sam pushed the button!", the accused capsules slide
  into the airlock, a 15 s "make your case" bar, then the vote: a chip per voter that ticks
  when they've voted (not how), then all votes at once. A failed vote lists who said No.
- **End:** the airlock opens, each accused capsule flips to HUMAN or ALIEN, then every
  role, "The humans win!" or "The aliens win!", 8 s, then `party.end`.

## Phones
No sounds on phones (a neighbour could hear a secret). Your colour and name at the top.
- **Role card:** covered; tap to show, tap to hide (so a neighbour can't read it).
  "You are HUMAN" or "You are an ALIEN" (+ the other aliens, hacks left).
- **The button:** a big red button at the bottom while you have it and pushing is allowed.
  Then pick exactly as many players as there are aliens (not yourself), and **Accuse** (25 s).
- **Captain picks:** test type (Write, Draw, Opinion), then tap the players, then **Start test**.
- **Everyone else, during the pick:** the crew grid. Humans tap to mark suspects (private
  notes); aliens tap to place a hack. Both look the same, so tapping gives nothing away.
- **Being tested:** your prompt and `party.ui.timer`. Write: `textInput` (60 chars). Draw:
  `drawPad`. Opinion: 4 big buttons (Strongly disagree … Strongly agree).
- **Not tested:** "Sam, Ana and Lee are being tested" and your notes.
- **Vote:** the accused's names, **Eject** / **Keep**. The accused don't vote.

## Rules
1. Roles are dealt at random. 10 s to read them. The clock starts: 3 min + 1 min per player.
2. The captain is a random player, then the next connected player in seat order after each test or failed vote.
3. **Pick (25 s):** the captain picks a test type and players (themself allowed). Too slow: random.
4. **Hacks (aliens, during the pick, not in the first test):** a hack sits on a player until they
   are next tested, then that test gives them the other prompt: a human gets the alien prompt
   (and doesn't know), an alien gets the human one (cover). Hacks lock when the pick locks.
5. **Test:** Write 45 s, Draw 60 s, Opinion 20 s; ends early when all tested players answered.
   Humans get the prompt, aliens a close but different one (Write: "a pizza topping" vs
   "something you put on toast"; Draw: "a cat" vs "a fox"; Opinion: "Breakfast is the best
   meal" vs "Cereal is a soup"). About 20 hand-written pairs per type, none repeated in a game.
6. **Reveal + discuss (60 s):** after 20 s the captain may tap **Next test**.
7. **The button:** once per player per game, in the pick and discuss phases (not while people
   are answering). The clock pauses. The presser picks the accused (25 s, or the use isn't
   spent), 15 s to argue, 20 s to vote. A missing vote counts as No.
8. **All Eject:** the accused are ejected and the game ends. **Any No:** the vote fails, the
   button is spent, a new captain, the clock runs on.
9. **Last call:** at 0:00, 30 s in which anyone may push once more, even with their button spent.

## Ending and winner
- Humans win if an ejection removes exactly the aliens. Aliens win if an ejected player is
  human, or if last call ends without an ejection.
- A team game, no ties: rankings list the winning team, then the losing team (seat order
  within each); scores 1 for winners, 0 for losers.

## Length
- A test: pick 25 s + answer 20–60 s + cards ~6 s + discuss 20–60 s ≈ 1.2–2.5 min.
- Clock 3 + 1 per player: 7 min at 4 players (≈ 3–5 tests), 13 min at 10 (≈ 5–9 tests).
- Each button: 25 + 15 + 20 + 5 s ≈ 1 min, paused; usually 1–3 per game.
- Total: roles 10 s + clock + 1–3 min of votes + 30 s last call + 8 s end ≈ **8–12 min at 4
  players, 14–17 at 10**. The original runs about 20; 10 players need the time to test everyone.

## Art
- **Palette:** blueprint navy `#0b1d33` with a faint grid, cyan line `#4fd1ff`, card paper
  `#eef4ff`, captain amber `#ffc94a`, alarm red `#ff3b5c`; the 10 player colours on top.
- **Style:** a station schematic: thin glowing cyan outlines, rounded rectangles, crew as
  round space helmets (a dome in their colour, a round visor, an antenna); answer cards are paper.
- **The airlock:** two door halves at centre right that slide open.
- **Motion:** a slow scan line sweeps the grid; cards slide in with a small overshoot;
  the button shakes the screen with a red flash; the doors slide; roles flip like cards.
- **Sound (big screen only):** `go` when a test starts, `tick` in the clock's last 10 s,
  `blip` per card, an alarm (`sound({ notes: [880, 440, 880, 440], ms: 140, type: 'square' })`)
  on the button, `pop` per vote, `win`/`lose` at the end.
- Canvas for the background (grid, hull outline, scan line); HTML and CSS for helmets, cards and text.

## Closest example
`none`: Bumper Blobs is real-time; this is phases and secrets. Built: ~58 KB (prompts ~7 KB),
under 100 KB.

## Edge cases
- **A player leaves:** skipped as captain and in votes; their test answer shows "(no answer)".
  They keep their role and can be accused. Back: their phone redraws from its state.
- **The captain leaves:** the 25 s pick timer picks at random.
- **The presser leaves while choosing:** cancelled after 25 s, use not spent.
- **Nobody acts:** every phase has a timer; the clock ends the game.
- **Too few left:** with fewer than 3 connected, votes still work (only connected
  players vote); an all-disconnected room times out.
- **Big screen reload:** everything is in one JSON object saved with `party.save` after each change:
  phase and its end time (server time), clock left, roles, hacks (arrays), captain, buttons,
  used prompts, the current test and answers, the vote. A drawing is at most ~15 KB (the
  drawPad's cap; over 20 KB is refused), so a 4-drawing test stays under the save limit. A cut-off phase resumes with its deadline.

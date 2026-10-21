# Punchline

## Genre and feel
A writing-and-voting party game (like Quiplash), set in a late-night comedy club. Everyone
writes funny answers to silly prompts on their phone at the same time; then each prompt's two
answers go head-to-head on the big screen and everyone else votes for the funnier one. The
room laughs at the answers first and finds out who wrote them second. Loud, quick, no skill
needed beyond being a little silly.

## Players
3–8 (`minPlayers` 3, `maxPlayers` 8).
- **Why 3:** with 2 players there's nobody left to vote on a head-to-head.
- **Why 8:** every player is in two matchups, so a round has as many matchups as players.
  At 8 that's already ~3 minutes of voting a round; more would drag.

## How prompts are dealt (rounds 1 and 2)
- Players sit in a ring (seat order). There are as many prompts as players; prompt *i* goes
  to player *i* and player *i+1* (the last one wraps round to the first).
- So **everyone answers exactly 2 prompts**, everyone faces two different opponents, and
  **odd player counts work** with no one left out. The ring is shuffled each round so the
  pairs change.
- **Why the ring:** it's the simplest deal that gives every player the same amount of
  writing, for any count from 3 to 8, and nobody waits while others write.

## Big screen
- **Always:** the club: a deep curtain backdrop with slow folds, two spotlights sweeping, a
  row of marquee bulbs along the top. The round name top left ("Round 1", "Round 2",
  "The Last Word"), and a small scores strip at the bottom between matchups.
- **Intro (8 s):** "PUNCHLINE" on the marquee, and three lines: "Answer 2 prompts on your
  phone. Your answer goes head-to-head with someone else's. Everyone else votes for the
  funnier one."
- **Writing:** "Answer on your phones!" and a timer bar; every player as a round badge in
  their colour with 2 small dots that fill as they finish each answer. No answers are shown.
- **Matchup, voting:** the prompt big at the top, the two answers as speech bubbles left
  (coral) and right (teal) with "VS" between them. **No names yet**, so votes are about the
  joke, not the friend. A timer bar. A row of voter chips that tick when each one has voted.
- **Matchup, reveal (6 s):** each voter's chip drops onto the bubble they picked, then the
  authors' names slide in under their bubbles with "+200". All the votes to one side:
  "SWEEP!" stamped across it, with a bonus.
- **Scores (8 s, after rounds 1 and 2):** a leaderboard of bars in player colours that grow to
  their new length.
- **The Last Word:** one prompt, everyone's answer as a card in a grid (shuffled, no names),
  then everyone's votes as chips on the cards, then the names.
- **End (10 s):** "The funniest person in the room is…", the winner's badge big in the
  spotlight with the others below (everyone tied for first shares the spotlight), then `party.end`.
- **While a reveal plays,** the scores strip still shows the scores from before it: a jump
  there would give away who wrote what before the names slide in.

## Phones
Your colour and name at the top. Big buttons at the bottom, one thumb.
- **Intro:** "Get ready to be funny." and how it works in one line.
- **Writing:** "Prompt 1 of 2", the prompt in big text, `party.ui.textInput` (60 characters,
  Send) and a smaller **Pick one for me** button that fills in a random safe answer
  ("A very confused goose"). Then prompt 2. Then "All done! Waiting for the others." and the
  timer.
- **Voting (not in this matchup):** the prompt, then the two answers as two big buttons
  (coral, teal). After tapping: "Voted!".
- **Voting (in this matchup):** "That's your prompt! Hands off the vote." Players can't vote
  on their own matchup.
- **Reveal and scores:** the prompt on stage, "Look up! Who wrote what?", your score and
  place (ties share a place).
- **The Last Word:** one prompt and one answer; then every other answer as a button (not
  your own) to vote for.
- **End:** "You came 2nd of 5 with 1,400 points." (or "You won!").

## Secrets
- **Each answer:** only its writer, until its matchup. Then the answers are shown **without
  names**, and who wrote which is revealed after the votes.
- **Each vote:** only its voter, until the matchup's reveal drops every chip at once.

## Rules
1. **Intro** 8 s.
2. **Writing** 75 s (rounds 1–2, two prompts) or 45 s (The Last Word, one prompt). It ends
   early when every connected player has answered everything.
3. **Running out of time:** an unanswered prompt gets a random safe answer, marked
   "picked by the house" on the big screen at the reveal. So every matchup can still be
   voted on, and a player who left still has answers. (Why not skip it: a skipped matchup
   is a dead moment; a house answer is often funny on its own.)
4. **Voting** 15 s per matchup (25 s for The Last Word); ends early when every connected
   voter voted. Voters are everyone except the matchup's two authors. A vote must be for one
   of the two answers (A or B); a later vote replaces an earlier one.
5. **Points:** Round 1: 100 per vote. Round 2: 200 per vote. **Sweep** (every vote cast went
   to you, with at least 2 votes cast): a bonus of 100 × the round. The Last Word: 300 per
   vote; you can't vote for yourself.
6. **Prompts:** ~150 built in, family-friendly, none repeated in a game.
7. **Answers:** trimmed, 1–60 characters, control characters removed; shown as text only.

## Ending
- After The Last Word: rankings by points (ties keep seat order), scores are the points.

## Length
- Round 1 or 2 at N players: writing ≤ 75 s + N matchups × (vote ≤ 15 s + reveal 6 s) +
  scores 8 s ≈ 1.4 + 0.35·N min: about **2.5 min at 3, 4.2 min at 8**.
- The Last Word: writing ≤ 45 s + vote ≤ 25 s + reveal 10 s ≈ 1.3 min.
- Total with the intro and end: **about 6–7 min at 3, 10–11 at 8**, less when everyone is
  quick (writing and votes end early). `minutes` is `[5, 12]`.

## Art
- **Palette:** curtain plum `#4a0f2e` (folds `#6b1840`), stage black `#1a0b14`, spotlight
  cream `#fff4d8`, marquee yellow `#ffd23f`, side A coral `#ff6b6b`, side B teal `#2ec4b6`;
  the 8 player colours on top.
- **Style:** a comedy club stage: curtains drawn on a canvas, warm spotlights, answers as
  thick-outlined speech bubbles with a little tail, players as round badges with their
  initial. The same in light and dark (it's the scene).
- **Motion:** bubbles pop in with an overshoot; vote chips drop onto the bubble they picked;
  "SWEEP!" stamps in rotated; score bars grow; the spotlights sweep slowly.
- **Sound (big screen):** `go` when writing starts, `tick` in the last 5 s of a timer,
  `pop` per vote landing, `coin` when points appear, a fanfare for a sweep, `win` at the end.
  Phones: `tap` when an answer is sent.
- Canvas for the club (curtains, spotlights, bulbs); HTML and CSS for text, bubbles and badges.

## Edge cases
- **A player leaves:** their unanswered prompts get house answers when writing ends; they
  aren't waited for as a voter; their matchups still play. Back: the phone redraws from its state.
- **Only one voter (3 players):** works; a sweep needs 2 votes, so no bonus at 3.
- **Nobody votes in a matchup:** 0–0, no points, the reveal says "No votes!". A matchup with
  no connected voters at all (3 players, the voter left) doesn't wait out its timer.
- **Big screen reload:** everything is one JSON object (`party.save` after each change):
  phase and deadline (server time), round, the deal, answers, which matchup, votes, scores,
  used prompts. A cut-off phase resumes with its deadline.

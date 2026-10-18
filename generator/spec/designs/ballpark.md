# Ballpark

## Genre and feel
An estimation game in the style of Wits & Wagers. A question with a number for an answer
("How many stitches are on a baseball?"). Nobody knows it exactly, so everyone guesses on
their phone. The guesses go up on the big screen in order, and then everyone **bets** on the
guess they think is closest without going over: it doesn't matter if you're bad at trivia, you
can win by backing the right friend. The look is a ballpark at night: a mown-stripe green
field, an amber light-bulb scoreboard, and the guesses as cream number plates.

## Players
2–10 (`minPlayers` 2, `maxPlayers` 10). Everyone plays every question; nobody waits for a turn.

## How a question goes
1. **Guess (40 s):** the question is on the big screen and every phone. Each phone types a
   whole number on a big keypad and presses **Lock in**. The round moves on as soon as
   every connected phone has locked in.
2. **The board:** the guesses, sorted from smallest to largest, become plates on the big
   screen (the same number from two players is one plate with both names). On the far left
   is one more plate, **"Smaller than all"**, for when every guess is too high.
   Each plate has odds: the middle plate(s) pay **×2**, and each step away from the middle
   pays one more (×3, ×4, up to ×5). "Smaller than all" pays **×6**.
3. **Bet (30 s):** each player has **two free betting tokens** to place on any plates (both
   on one is fine). On each token you can also stake **extra chips** from your score. Then
   **Lock bets**. The round moves on as soon as everyone has locked their bets.
4. **Reveal (11 s):** the answer counts up on the scoreboard. Every plate above it turns red
   and drops; the **winning plate** is the largest guess that isn't over the answer (or
   "Smaller than all" if every guess was over). Payouts:
   - a token on the winning plate pays **odds × (1 + its chips)**;
   - chips on a losing token are lost;
   - whoever wrote the winning guess gets **+3**, for being closest.
5. **Scores (6 s):** the standings, then the next question.

7 questions in a game. The best score wins. On a tie, the player who locked in their guesses
faster in total ranks higher (`party.now`).

## Why these rules
- **"Closest without going over", not plain "closest".** It's what makes the odds board
  work: exactly one plate wins, there are no ties to split by distance, and "Smaller than
  all" gives a long shot worth ×6. It's also the moment the room shouts at the scoreboard:
  "you went over!".
- **Bets, not just guesses.** In plain trivia, the person who knows wins every round.
  Betting lets everyone win by reading the room, and the two free tokens mean a player at 0
  points is never out of it.
- **Chips from your score** are the comeback and the risk: a big stake can double your score
  or empty it. Losing only loses the chips you staked, never the free tokens.
- **Whole numbers only.** A keypad of 0–9 is one-thumb friendly, with no decimal point and
  no minus sign to get wrong. Every built-in answer is a whole number of at least 1.
- **Stable facts.** The questions are about things that don't change from year to year
  (dates, measurements, game rules, nature), not populations or records, so the file
  never goes out of date. They're family-friendly; no player text is shown, only numbers.

## Big screen
- **Always:** the scoreboard header ("BALLPARK", "Question 3 of 7", a timer bar), the
  question in big cream text, and along the bottom, a scoreboard strip: each player's
  colour, name and score, with a tick once they've locked in (never their guess, until the
  board).
- **Guess:** the question, "Guess on your phone", and how many have locked in.
- **Bet:** the plates in a row, each with its number, odds badge and the guessers' names.
  Tokens appear as coloured chips above a plate as players place them (the amounts stay
  hidden until the reveal).
- **Reveal:** the answer ticks up on the amber scoreboard. Plates that are over turn red
  and drop, the winning plate glows gold, and "+N" pops up over each winner's chips.
- **Scores:** a standings board, then the next question. The end shows the final
  standings and the winner for 10 s, then `party.end`.

## Phones
Your colour and name at the top, your score, and the question.
- **Guess:** the number in a big display (with thousands separators), and a 3×4 keypad:
  1–9, ⌫, 0, and **Lock in**. A physical keyboard's digits and Enter work too.
- **Bet:** the plates as a list of big rows (smallest at the top), each with its number,
  odds and guessers. A tap places your next free token on that row. "Your bets" below shows
  each placed token with a **− chips +** stepper (limited to your score), **Take back**,
  and **Lock bets**.
- **Reveal and scores:** what you won or lost this question, and your place.

## Secrets
- **Each guess:** only its guesser, until the Bet phase puts every guess on the plates. Until
  then the big screen shows only a tick when a player has locked in.
- **Bets:** where a token goes is public as it's placed (a chip above the plate), but **how
  many chips** are on it stays with its player until the reveal.

## Length
Per question: 40 s guess + 30 s bets + 11 s reveal + 6 s scores, at most ~1.5 min; usually
~1 min, since phases end when everyone has locked in. 7 questions + intro and end: **6–10
minutes** (`minutes` [6, 10]).

## Sound
Big screen: a tick in the last 5 s of each timer, a pop when a plate drops, a coin for each
winning plate, and a win fanfare at the end. Phones: a soft tap on the keypad.

## Edge cases
- A phone that left is skipped for "everyone locked in"; its guess (if any) stays on the board.
- No guesses at all: the board is skipped ("Nobody guessed!"), the answer is shown, no points.
- A big-screen reload resumes on the same question and phase: the whole game is one JSON
  object saved with `party.save`, with deadlines as server times.

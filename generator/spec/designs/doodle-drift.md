# Doodle Drift

## Genre and feel
A drawing-telephone game (like Telestrations): everyone writes a phrase in their own
sketchbook, then the books pass from phone to phone, alternating **draw what you read** and
**guess what you see**. Nobody sees a whole book until the end, when the big screen replays
each book page by page and the room watches "a cat on a skateboard" drift into "grandma's
lawnmower". Loud, silly, no skill needed: bad drawings are the point.

## Players
4–8 (`minPlayers` 4, `maxPlayers` 8).
- **Why 4–8:** with 3 the chains are too short to drift; above 8 the reveal gets long and the
  drawings stop fitting in one `party.save` (see Limits).
- **Pages per book after the phrase (R):** always even, so every book ends on a **guess**
  (the punchline is "it started as X, it ended as Y"): 4 players → 4, 5 → 4, 6 → 6, 7 → 6, 8 → 6.
  With an even number of players (4, 6) the last guess goes back to the book's owner: they
  guess what their own phrase turned into, which is a fun moment of its own.
- Round r (1..R): the player in seat i works on the book of the player in seat (i − r) mod n.

## Big screen
Its own look: a cobalt-blue desk with cream sketchbook pages, strips of tape, slightly
crooked cards, and pencil-yellow highlights. Each player has a coloured notebook.
- **During a round:** "Round 2 of 7: Draw!" with a big instruction ("Draw the phrase you
  got"), a shrinking timer bar, and the row of notebooks: each in its owner's colour with
  their name, a wiggling pencil while they work, a gold check when they're done. Nothing
  anyone wrote or drew is shown before the reveal.
- **Pass (2.5 s):** "Pass the books!": the notebooks slide one seat along.
- **Reveal, a book at a time:** "Ada's book". The first page ("Ada wrote:") alone, then
  each next page appears next to the one before: **what they saw → what they made**, with
  "Bo drew:" / "Cy guessed:". Dots at the bottom show how far through the book we are.
  Text pages stay 5 s, drawings 7 s; the book's owner can tap **Next** on their phone to go
  faster.
- **Favourites (after each book, up to 15 s):** "Started as: …" and "Ended as: …" side by
  side, and "Vote for your favourite page on your phone", with how many have voted.
- **Final (12 s):** "Crowd favourites": each player with a bar of the votes they got, and the
  single most-voted page shown big. Then `party.end`.

## Phones
Your colour and name at the top. Big targets, the main control at the bottom.
- **Write (45 s):** "Write something for someone to draw" with `textInput` (60 characters)
  and "Stuck? Tap one:" with three suggestions (tapping one sends it).
- **Draw (75 s):** the phrase on a paper card, `drawPad` (6 colours), and **I'm done**.
  Every finished stroke is already sent, so running out of time keeps what you drew.
- **Guess (40 s):** the drawing (`drawing`) and `textInput` "What is it?".
- **Done:** "Sent! Waiting for the others" with the timer.
- **Pass:** "Passing the books…".
- **Reveal:** "Watch the big screen". The book's owner also gets a big **Next** button.
- **Favourites:** the book's pages as cards (drawings as thumbnails, guesses as text), each
  with who made it; tap one to vote. Your own pages can't be picked.
- **Final:** how many votes you got and your place.

## Secrets
- **Every phrase, drawing and guess:** only the player who made it and the next player in the
  book, until that book's reveal. The big screen shows who's done, never what they wrote or drew.

## Rules
1. **Write:** everyone writes a phrase at once. Time runs out with nothing sent: the big
   screen picks one of the built-in suggestions for you.
2. **Rounds 1..R** alternate **draw** (odd) and **guess** (even), all players at once. A round
   ends when its timer runs out, or early when every connected player is done.
3. **Draw:** you draw the most recent phrase in the book you hold. A blank drawing (nothing
   drawn in time) counts as blank.
4. **Guess:** you type what the drawing in front of you shows. If that drawing is blank, you
   get a breather this round ("Nothing to guess this time") and the book carries the last
   phrase forward. A guess not sent in time is blank; the next drawer then draws the last
   phrase the book has.
5. **Reveal:** every book in seat order, then the favourites vote for it.
6. **Favourites:** each player may vote for one page in the book that isn't their own.
   Each vote is a point for the page's author. Ends early when every connected player who
   can vote has voted (but stays at least 5 s, so the room can read the summary).
7. **End:** rank by points (votes received); `scores` are the votes.
8. Players who leave are skipped: their pages are blank (or their last strokes), and nothing
   waits for them.

## Length
Write 45 s, draws 75 s, guesses 40 s (most rounds end early), 2.5 s passes; reveal ~5–7 s a
page plus up to 15 s of favourites per book.
- 4 players: ~4 min of rounds + ~2.5 min of reveal ≈ 6–8 min.
- 8 players: ~6 min of rounds + ~6 min of reveal ≈ 10–14 min.
- `minutes`: [6, 14].

## Limits (why the numbers)
- A drawing from `drawPad` can be up to ~15 KB, and `party.save` holds about 110 KB. 8
  players × 3 drawings each = 24 drawings, so the big screen **simplifies every drawing it
  receives** to at most ~3 KB (it drops points that lie almost on a straight line, a bit more
  each try until it fits). On a 1000-wide sheet the difference can't be seen on a TV.
- Phones only ever get the one page they work on (or the one book they vote on): a few KB.

## Why these choices
- **Rounds in step, with a timer** (not each player at their own pace): the whole room is in
  the same moment ("Draw!", "Guess!"), the TV always has one clear thing to show, nobody gets
  stuck with a pile of books waiting for a slow player, and a reload of the big screen just
  resumes the round. Rounds end early when everyone's done, so fast groups don't wait.
- **Points, but light** (favourites, not "right answers"): scoring correct guesses makes
  people draw carefully, which kills the joke. Voting for the funniest page rewards exactly
  what the game is about, keeps everyone's phone busy during the reveal, and still gives a
  winner for `party.end`.
- **Even page counts:** every book ends on words, so the summary is always "started as" vs
  "ended as" in big text the whole room can read.
- **Suggestions** for the first phrase so nobody freezes, but players write their own: no big
  word list, and the phrases are the room's own jokes.

## Art
Cobalt desk (#2442c9 → #1b2f94), cream paper (#fffaf0) with soft shadows and tape strips
(translucent yellow), ink-black text, pencil yellow (#ffd23f) for highlights and the
checks. Player colours on their notebooks. Slow drifting doodles (loops, stars, squiggles)
on the desk in a lighter blue. Cards tilt by a degree or two; new pages pop in. Drawings
are always on white paper.

## Sounds (big screen)
Round start: go. Everyone done / pass: pop. Last 5 s of a round: tick. A page appears: blip.
A favourite vote: tap. Final: win.

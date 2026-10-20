# Remix, design first: the experiment (2026-10-20)

Plan §45b. **Decided: build it.** A remix's big change goes through its own whole design, then a
whole-file build from the original's code, instead of a change plan and edits.

**Setup.** The 7 official games, each remixed ("<name> - Remixed") with one change to how it plays
(power-ups, a new test type, a new voting system, scoring, double down, a claim freeze, a fifth
station), run on qwen3.8:27b in the site's sandboxes, both ways:
- **(a) the change loop**, as built for §45: a change plan, then edits (the whole file after two
  edits that don't fit), then the code review.
- **(b) design first**: the remix's whole design (the new-game format, from the original's design
  and the request, without the code), then the whole file from both designs and the original
  code, then the code review against the new design. Stowaways (62 KB) is over the 60 KB a whole
  file can be (both copies must fit the context), so it used edits.
- **The yardstick:** a checklist made from (b)'s new design; both arms' games reviewed against it.
  It leans toward (b), which was built to that design, but the design is the request worked
  through the whole game, so it's what the creator asked for.

**Results.**

| Game | (a) attempts, minutes | (b) attempts, minutes | Score (a) | Score (b) |
|---|---|---|---|---|
| Bumper Blobs (power-ups) | 1, 18 | 2, 19 | 54/89 | **74/89** |
| Punchline (new voting) | 5, 48 | **2, 30** | 52.5/62 | **58/62** |
| Claim Jumpers (claim freeze) | 3, 34 | **1, 17** | 117/127 | **125/127** |
| Comet Crew (fifth station) | 2, 39 | **1, 28** | – | – |
| Ballpark (double down) | 3, 30 | 2, 33 | – | 94.5/115 |
| Doodle Drift (scoring) | 1, 20 | 1, 23 | – | 86/94 |
| Stowaways ("Rate it", edits) | 2, 24 | 4, 48 | – | – |

- **Both passed on all 7.** (b) needed fewer attempts on the biggest reworks (Punchline 5 → 2,
  Claim Jumpers 3 → 1) and was faster there; the design step itself took 1–3 minutes (9 for
  Stowaways).
- **(b) scored higher on every game both could be scored on** (3 of 3). 4 of the 14 scoring
  reviews failed (the model ran out of room or wrote nothing on the bigger files), so the rest
  can't be compared: the evidence is the attempts, the times and these 3 games.
- **Polish:** Punchline's new design describes its look ("vote chips drop onto the card they
  picked", speech-bubble cards), and (b) kept the chip drop that (a) lost. Neither kept the
  speech bubbles' tails.
- **The cost: whole-file rewrites drop the code's comments** (Claim Jumpers 23 → 0, Ballpark
  21 → 0, Punchline 35 → 1) and touch far more lines (Comet Crew: (a) +67 −12, (b) +354 −483).
  Players don't see it, but later changes read less clear code. The build prompt should ask to
  keep the comments.
- **Games over 60 KB** (only Stowaways) fall back to edits and struggled the same way as (a): 3
  edit attempts that didn't fit, one out of room, then passed on the 4th.

The script and every game, design and review: `remix-test/` in the session's scratchpad (not kept).

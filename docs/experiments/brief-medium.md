# Brief medium: testing the short-plan sentence (2026-10-18 to 10-19)

Plan §43. **Where it landed:** the full sentence stays, plus "Draw the characters and the big
moment… with shapes"; fix requests leave it out. The switches these tests used (`briefVariant`,
`fixBrief`, `wholeOnParseError`) were removed on 2026-10-19.

With the new DESIGN.md, plain medium still thinks far too long on bigger games (heist ran out
of room at 57,873 tokens; pond took 19 min), so the short-plan sentence stays. What to test:
1. **Does the game have what the design says?** A checklist per design (phases, twists, skills,
   numbers, characters, the big moment, sounds) ticked off in the code and screenshots, brief
   against plain on the same design.
2. **The sentence, part by part.** Its plan list is all mechanics (state, phones, timers,
   leaving, reloads): the art and the big moment aren't in it. "Follow the reading closest to
   its words" may push the bare minimum. Try adding "the look and the big moment" to the plan,
   and "build everything the design describes, including the art".
3. **First files with typos.** Most brief first files have a syntax error or an undefined name
   (a blank screen). Fixes are cheap (15–60 s) when they work.
4. **Fix rounds that fall apart.** When a brief first file is badly broken (pond: unbalanced
   brackets), the fixes can spiral: a 26K-token "edit" that rewrites the game, edits whose
   SEARCH text isn't in the file, then a new whole file that crashes. The sentence also stays
   in the prompt during fixes. Ideas: drop it from fix requests; after one failed edit round on
   a file that doesn't parse, ask for the whole file at once.
5. **Repeat runs:** builds vary a lot; 3 per variant before deciding.
6. **Play them:** a short scorecard (ran as designed, real choices, art matched, the big moment
   landed, how long it took).

**Results so far.** Test 1 (bake-off and heist, brief vs plain on the same design): every
mechanic made it into both; both lost the same costly art (the bake-off's alien judge became
an 👽 emoji in both). Test 2 (2 builds × 3 sentences × 2 designs): 3 of 4 passed for each, none
ran out of room. Adding "the look" to the plan barely helped; **"Draw the characters and the big
moment the way the design describes them, with shapes; don't replace them with emoji or plain
circles"** got both bake-offs a drawn judge (arms, fork, monocle) instead of an emoji, at no cost.
The heist's art was drawn by every variant. That sentence is now part of BRIEF_THINKING.

**Fix rounds (test 1 of the list, 32 builds: 4 designs × 4 variants × 2).** Leaving the
sentence out of fix requests ("nobrief") passed 8 of 8 and fixed all 5 broken first files in one
round each, with no edits that didn't fit (median fix reply 1.6K tokens, worst build 525 s).
Today's way passed 6 of 8 (16 fix rounds for 6 broken files, 5 that didn't fit, worst 1,106 s).
Asking for a whole file after a syntax error helped a little alone and hurt with nobrief (fixes
rewrote the game). **Fixes now leave the sentence out** (`fixBrief: true` keeps it, to compare).
Also: `players is not defined` crashed many builds: the rulebook's skeleton unpacked `players`
in `party.ready` but never passed it on. The skeleton (and /kit's) no longer does, and the SDK
list says to write `party.players` in your own functions.

**The sentence, part by part (24 builds).** Without "work out only the tricky parts", thinking
was no longer (median 3.4K against 5.2K) and the games no less complete, though first files
passed least often (1 of 8); "plan briefly" is what keeps it short. Without "follow the reading
closest to its words", the heist games had ~25% more code, some of it real design detail (cameras
scaling with players), some dead (a whole drawing function written twice, one never called),
plus a solo-mode bug; the bake-off's extra size was spacing. Same pass rates (7 of 8 each). The
full sentence stays. Reading the code mattered: keyword checklists missed things both ways.

## Whole other sentences (2026-10-21)

Nine different planning sentences against today's (`briefText`, the art sentence kept in all),
each building the heist and the bake-off designs twice (40 builds; `generator/out/sentence-*`).
"bare": think briefly; "budget": ~2,000 words; "outline": only an outline of the file;
"walkthrough": one round as the players see it; "phases": the phases and what moves each to the
next; "risks": the three things most likely to break it; "checklist": every rule as a checklist;
"decisive": decide quickly, don't revisit; "noplan": no planning, write at once.

**Thinking before the first file** (heist ×2, bake-off ×2): risks 4.7K/4.3K/4.1K/4.3K and phases
3.9K/4.7K/6.7K/6.8K were short and steady; control 10.4K/6.7K/2.2K/3.4K; the open-ended ones
swung wildly: decisive 49K/31K/2.0K/1.2K, bare 7.9K/53.6K (out of room)/5.7K/6.6K, checklist up
to 49K. "Don't overthink" doesn't make it think less.

**Passing** didn't separate them: the bake-off failed 8 of 20 across the variants, the control
too, almost all on a syntax error ("missing ) after argument list", a name declared twice) that
3 fix rounds of edits couldn't repair.

**Reading the 32 passing games** for the known failure points (heist: spotting, the lockpick,
the decoy, a reachable exit, the end screens; bake-off: uniqueness scoring, the multipliers,
picks served at time-out, phones redrawn) found, by variant, the games with no serious bug:

| Variant | Good games (of 4) | What was wrong |
|---|---|---|
| decisive | 4 | (dense code: one heist file has 1 comment) |
| control | 3 | one bake-off failed; a heist without the thieves' hoods, 5 of 8 sounds |
| noplan | 3 | one bake-off failed |
| bare | 2 | out of room; uniqueness scored wrong (an index compared with a player id) |
| outline | 2 | heist spotting never fills (reset every move); bake-off scores all NaN (× an object) |
| phases | 2 | heist lockpick needs 3 presses 30 s apart (Wing 2 can't be beaten), no end screens; a failed bake-off |
| walkthrough | 2 | heist spotting reset every frame (nobody is ever caught); a failed bake-off |
| risks | 2 | heist spotting reset by any other guard in range; a bake-off failed (names as HTML) |
| budget | 1 | instant lockpick, a decoy that teleports the guard onto the thief, uniqueness wrong; a failed bake-off |
| checklist | 1 | spotting drains per guard (too slow with several); both bake-offs failed |

Four builds per variant is too few to rank them: the gaps are within what chance gives. **No
sentence clearly beats today's**, so it stays. Short, steady thinking (risks, phases) didn't make
better games. What the reading showed instead:
- **The same bugs recur:** a timer reset every frame or per guard, so it never fills; an index
  compared with an id; a number multiplied by an object (NaN). They pass every check.
- **The checks can't see NaN or "undefined" on screen,** which outline-1 showed on every score:
  worth a check of its own.
- **Fix rounds don't repair some syntax errors** in 3 edit attempts: worth its own look.

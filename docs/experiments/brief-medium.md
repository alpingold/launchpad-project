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

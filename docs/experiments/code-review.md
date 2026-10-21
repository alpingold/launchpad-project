# The code review: calibration and the review-and-fix test (2026-10-19)

Plan §47. **Decided: every build on the site ends with one review round**; "Review again" runs
another.

- **Calibration** on the §43 games (11 games, 95- and 149-item checklists): it found everything
  found by reading the code by hand, plus bugs no check caught: an exit that can't be reached
  (clamped to x ≤ 960, the win needs x > 960), a vault wing won without the diamond, a big screen
  drawn once and never again, a tie-break that crashes. Two reviews of the same game agree on 83–95%
  of items; scores move by up to ~6%, so small score gaps between builds are noise. The serious
  bugs mostly came back the second time, but not always: one review missed the vault bug the
  other found (and said the opposite).
- **The review-and-fix test** (server/scripts/review-fix.js): the critical bugs of each game went
  back as a small change request. 12 critical bugs on 9 games: 10 real (all fixed correctly), 2
  false alarms (harmless, equivalent code). Every fix passed the checks, changing 2–13 lines; no
  design score dropped. But 2 games still couldn't be won after it: a bug the review hadn't
  listed. One round makes games clearly better, not bug-free.

**The site's way, end to end in the sandbox (2026-10-19):** "Review again" on heist notricky-1
took ~11 minutes and found 6 bugs; it fixed the dead end (a solo player couldn't change skill:
the phone sent `skill: undefined`, which JSON drops), using the icon the player tapped. The bugs
now read player-first ("Solo player can never cycle skills…"). It missed the unreachable exit
again: 3 reviews of 4 missed it, which is why a deterministic check beats the reviewer there.

## The reviewer on big files: no number, or critical bugs only (2026-10-21)

The review often wrote nothing on big games (40–62 KB remixes). Two ideas, against today's
reviewer, on the 7 official games (18–62 KB; twice each) and the 12 §47 test games (once each):
**(A)** today: a checklist with "Usually 30–60 items", every item answered, all bugs; **(B)** the
checklist without the number; **(C)** critical bugs only (crash, stuck), from the design and the
code, no checklist.

- **Reviews written:** A 25/26, B 23/26, C 21/26. C's 5 failures were all out of room on the
  big official games (Doodle Drift twice, Stowaways, Punchline, Comet Crew): it writes ~nothing
  (`{"bugs":[]}`) but, with no checklist to work through, thinks until the context is full.
- **No number made checklists bigger,** not smaller: Comet Crew 61 → 146 items, Stowaways
  91 → 143, Punchline 61 → 111 (the bake-off's went down, 149 → ~110). More to answer: more
  thinking, longer answers, 3 failures.
- **Bugs, checked by reading the code** (the §47 games, ~19 real crashes and dead ends): C found
  the most (~14), A ~11 (two by the wrong cause), B ~10. C alone found the exit that can't be
  reached and both "tie-break crash" and "scoring calls .filter on an object" in other builds;
  A missed the bake-off's scoring crash in control-1. False alarms: A ~4 (a late joiner in
  Punchline, a missing "back" handler: the platform resends a phone's last state anyway, a
  throttled timer), B ~1–2, C none found. No arm reported a crash or dead end in an official
  game except A once.
- **So:** critical-only is the better bug finder but needs its thinking held down on big files
  (the brief-thinking idea, for the reviewer). It also drops the design checklist and its score,
  which the creator's page shows today.

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

### Why the review ends with no answer, and the stopping rule (2026-10-21)

- **Not the thinking setting:** low effort and a "read the code once" sentence failed as often
  (official games 7/14 and 6/14).
- **Not the forced format:** without `response_format` (the JSON asked for in words) critical-only
  failed as often (10/26); an early 3-of-3 without it was luck. The full review without it wrote
  JSON that didn't parse 3 times.
- **Not a limit:** failures ended at 9.8K–21.4K thinking tokens, spread evenly, while successes
  at the same setting thought up to 25K; at medium 62 of 110 successes thought longer than the
  median failure. Not "out of room" either (e.g. 32K of 65K used): the reply stops mid-sentence
  with finish_reason "stop" and no content. Our "ran out of room" label was wrong for these.
- **Not the load:** one at a time, with nothing else running, 2 of 4 still failed.
- **It's when there's nothing to find:** critical-only failed mostly on the official games (no
  real crashes), its thinking going "Issue 78: let me verify…" without deciding it was done.
  **The stopping rule** ("If after reading the code once you have found no crash or dead end you
  can point to the lines of, stop and answer {"bugs": []}… finding nothing is a normal result")
  answered **11/12** on those games (all correctly, no bugs) and **12/12** on the §47 games, in
  ~2.7 minutes. It found ~11 of the ~19 real bugs (the frozen screen, both kinds of scoring crash,
  the tie-break crash, the unreachable exit, the solo skill row, losing Wing 3…), missing ~8 that
  critical-only without the rule found when it answered, with no false alarms.

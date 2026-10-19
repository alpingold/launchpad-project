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

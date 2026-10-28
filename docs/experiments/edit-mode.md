# Edit mode against whole files (2026-10-16)

Plan §23. **Decided: edit mode is the default for changes and fixes**; whole files stay as the
fallback and for a new game's first attempt.

**The experiment** (`generator/out/edit-exp/`, git-ignored; qwen3.8:27b, one run each, both
modes in parallel from the same plan). Subjects: Bumper Blobs (18 KB), "Realm Party" (F-rpg,
34 KB) and "Star Sprint" (F-platformer, 21 KB) from §20. E and F had a bug put in by hand
(each failed the checks before the change), so the fix loop had to run; G is a first build
(a Quiplash-style game, §22) whose first attempt happened to fail in edit mode's run.

| Case | Request | Mode | Passed | Attempts | Model time | Out tokens | Lines changed (+/−) |
|---|---|---|---|---|---|---|---|
| A | bumper: sounds for a fall and a round win (planned) | edits | ✓ | 1 | 11 s | 921 | +9 / −1 |
| | | whole | ✓ | 1 | 68 s | 6,229 | +23 / −27 |
| B | bumper: bigger blobs (small fix) | edits | ✓ | 1 | 6 s | 425 | +1 / −1 |
| | | whole | ✓ | 1 | 69 s | 6,287 | +1 / −1 |
| C | RPG: HP, level and gold on every phone (small fix) | edits | ✓ | 1 | 13 s | 968 | +10 / −0 |
| | | whole | ✓ | 1 | 135 s | 12,058 | +39 / −62 |
| D | platformer: 4 laps, lap on the phone (planned) | edits | ✓ | 1 | 8 s | 657 | +4 / −4 |
| | | whole | ✓ | 1 | 91 s | 7,696 | +4 / −4 |
| E | bumper with a bug: melt after 15 s | edits | ✓ | 2 (fix: edits) | 4 + 10 s | 299 + 822 | +2 / −2 |
| | | whole | ✓ | 1 | 71 s | 6,417 | +2 / −2 |
| F | RPG with a bug: boss +25% HP | edits | ✓ | 2 (fix: edits) | 14 + 6 s | 418 + 248 | +3 / −3 |
| | | whole | ✓ | 1 | 159 s | 11,381 | +6 / −10 |
| G | first build, Quiplash-style | edits | ✓ | 2 (whole, then a fix as edits) | 244 + 13 s | 14,179 + 757 | – |
| | | whole | ✓ | 1 | 175 s | 11,186 | – |

**What it shows:**
- **Everything passed both ways, and no edit ever failed to apply** (10 edit replies, 0
  failures), so the fallback was never needed live (it's covered by unit tests only).
- **Edit mode is 5–15× faster and writes ~10× fewer tokens:** 6–14 s per reply instead of
  1–2.5 minutes. A fix costs seconds instead of minutes (G's fix: 13 s, 757 tokens, where a
  whole-file fix used to take ~3 minutes and 10–20K tokens).
- **Whole files change what wasn't asked:** A-W and C-W deleted most comments (they explain
  the code to people), C-W and F-W swapped CSS-variable colours for fixed ones, F-W added a
  typo ("sighes"). The edit-mode results changed only the lines the task needed.
- **The honest cost:** with edits the model only does what it's told. In E and F, the whole-
  file runs fixed the hand-made bug on the way (they reread everything), while edit mode
  made the change, failed the check, and fixed the bug in a second, ~10 s attempt. Total
  time was still 2–3× shorter. C-E's status bar is drawn from the state phones get; C-W also
  added the stats to the setup screen's state, which C-E didn't (a smaller change, still
  passing the checks).
- One run each, mostly small games and small changes: big rewrites (a new phase, a new
  mode) weren't tried, and that's where edits are most likely to miss a spot.

**Recommended, and built that way:** edit mode is the default for changes and fixes; whole
files stay as the fallback and for a new game's first attempt. Worth watching in real use:
how often edits fail to apply (the admin page shows each attempt's mode and problems;
`npm run admin -- edit-stats` counts them by model, with calls that got no reply).

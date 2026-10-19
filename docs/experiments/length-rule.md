# Does the 5–15 minute rule help? (2026-10-18)

Plan §35. **Decided: removed** (it changed nothing measurable).

The rulebook says a game lasts "about 5–15 minutes unless the idea asks for something else",
and the design guide's Length section says "Aim for 5–15 minutes… change the design
instead of just reporting it." The worry: it's fluff that makes the model pad games with
extra rounds to hit a number, instead of designing what fits the idea.
- **The switch:** the `lengthRule: false` job option (design and build steps). It drops the
  5–15 minutes from both files. The rulebook keeps "each round takes at least about 20 s"
  and "don't make a game longer with waiting"; the design still works out its length.
- **Why every build gets its own design:** the rule mostly shapes the *design* (how many
  rounds), so one shared design would hide its effect. `compare-builds --fresh-design`
  designs first, per build, with that side's options.
- **The test:** the same Drawful Animate-style idea as §32, 4 builds with the rule and 4
  without. The size line stays in on both sides, so only one thing changes.
- **What to look at:** the `minutes` each game claims, its rounds, and playing them.
  Results go in `generator/out/length-rule/summary.md`.

**Results (2026-10-18):**

| | Passed | Avg size | Minutes the games claim |
|---|---|---|---|
| With the rule | 3 of 4 | 25.9 KB | 5–12, 3–9, 6–9, 7–11 |
| Without | 2 of 4 | 32.1 KB | 6–9, 7–10, 4–15, 5–12 |

- **The length didn't change.** Without the rule, every design still worked out its rounds
  and landed at about 4–15 minutes. The model already knows how long a party game runs.
- **The failures weren't about length:** a syntax error, and names used before they were
  defined. With a fresh design per build, the spread between builds is wide, so 2 vs 3
  passes is noise.
- **Without the rule, games came out ~25% bigger** (32 vs 26 KB), like §32's no-limit side.
  Four builds a side is too few to call it real.
- **So the rule is fluff:** it costs prompt space and changes nothing measurable.
- **Decided (2026-10-18): removed.** GAME_SPEC.md's Length line now only says a round takes at
  least about 20 s and not to pad a game with waiting; DESIGN.md still asks for the length
  arithmetic but no target. The `lengthRule` job option went with it.

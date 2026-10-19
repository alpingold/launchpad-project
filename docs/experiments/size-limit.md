# Does "At most 100 KB" in the build prompt change the games? (2026-10-17)

Plan §32. **Kept:** the line stays (the switch that removed it, `sizeLimit: false`, was removed
on 2026-10-19).

The idea: the line may nudge the model toward terse games, and we don't need it, since the
check after the build enforces the limit anyway.
- **The switch:** the `sizeLimit: false` build option leaves both mentions out of the prompt
  (the rulebook's line and the build instruction's last sentence).
- **The runner:** `npm run compare-builds` builds one design several times per variant,
  taking turns.
- **The test:** a Drawful Animate-style idea, one design, 4 builds with the limit and 4
  without. Results go in `generator/out/size-limit/summary.md`, plus playing them.

**Results (2026-10-18):**

| | Passed | Avg size | Avg first reply | Avg time |
|---|---|---|---|---|
| With the limit | 4 of 4 | 30.7 KB | 51.5K tokens | 17 min |
| Without | 4 of 4 | 34.6 KB | 36.2K tokens | 19.5 min |

- **Every build passed** on both sides. Without the line, games came out ~13% bigger, and the
  two biggest (37.6 and 37.8 KB) were both from that side.
- **First replies were much longer than expected:** 19–57K tokens, against the ~24K of
  thinking guessed above. Mostly thinking, since the games are only ~10–13K tokens. A 57K
  reply plus a ~6K prompt is close to the 65K window. That makes "budget the thinking" the
  first thing to look at.
- **No secrets leaked:** the design had a Secrets section, and no build's big screen showed
  the prompt while someone drew.
- **Four builds a side is too few to call the size difference real.** Playing them decides
  whether bigger means better.

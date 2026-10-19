# Does `party.kit` help? (2026-10-16)

Plan §20. **Decided: `party.kit` and the starter templates are gone**; builds get the rulebook
and the design only.

**Question (the user):** games may look too similar and worse when they lean on helpers. The
two ideas behind Checkpoint Dash and The Long Road were designed fresh with today's rulebook,
then each design was built twice: **K** (today: `party.kit` documented, the design's starter
template) and **F** (`helpers: false`: no kit section, no template). One run each. Files in
`generator/out/kit-exp/`.

| | K-platformer | F-platformer | K-RPG | F-RPG |
|---|---|---|---|---|
| Attempts | 1 | 1 | 3 | 1 |
| Model time | 4.6 min | 3.2 min (+14 min lost to an empty reply from GenAI Studio) | 10.3 min | 3.7 min |
| Prompt | 8.2K tokens | 5.4K | 9.3K | 5.7K |
| Code | 14 KB | 21 KB | 31 KB | 34 KB |
| Kit used | phases, colorOf | – | phases, colorOf, rank | – |

- **The kit is barely used even when offered** (2–3 small helpers), and **F passed first time
  both times**. K-RPG's two failed tries were its own bugs (a `Set` in saved state; a syntax
  slip), not the kit's.
- **The look comes from the design and the rulebook, not the kit.** K and F of the same design
  look almost the same (the platformer: three lanes, coloured circles with initials, grey
  blocks, stars). The rulebook's own "How to draw" advice (§18) is concrete enough to make
  games alike, and both platformers draw a thin band on an otherwise empty light page.
- **A small cost of no kit:** F-platformer wrote its own place labels and got them wrong
  ("2st", "3st"); the kit's `ordinal` would have been right.
- **The new rulebook changed the designs:** the platformer became a forgiving lane race
  ("Star Sprint"), the RPG a group-vote adventure ("Realm Party").

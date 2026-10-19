# A bigger helper library, and the example game (2026-10-16)

Plan §13o. **Decided: the example game's code left the build step**; the helpers it tested
(`party.kit`) were dropped later (§20, [party-kit.md](party-kit.md)).

**What the AI gets today.** Design step (~3,800 tokens): the rulebook (`GAME_SPEC.md`, ~3,000:
how games work, the rules, the `party` SDK ~950, the `party.ui` reference ~630), the design
format (~600), the art list and the idea. Build step (~14,000 tokens for The Long Road): the
rulebook 21%, the template the design picked 15%, **the example game's code 45%**, the
example's design 5%, the approved design 11%. (The experiment in 13n removed the example
*designs* from the *design* step; the example *game* is still in the build step.)

**The helpers work.** In all 9 games the AI built (four models), the `party.ui` helpers were
used for everything they cover (`el` for all HTML, `ascii` for every map, `gamepad`, `timer`,
`scoreboard`), with no hand-written buttons, canvas drawing or touch handling, and none of
the bugs we found were in a helper's area. Caveat: the example game uses them too, so some
of it may be copying.

**What the games still write by hand** (so, what new helpers would replace):

| Hand-written | Seen in | Candidate helper |
|---|---|---|
| Platformer physics: tile map, gravity, jumps, coyote time | all 3 platformers (copied from Tower Dash); gemma's failed build broke there | `platformer`: a tile world and bodies |
| Votes: collect, count, ties, time out, skip whoever left | every RPG | `vote` |
| Turn order, turn timeouts, skipping disconnected players | every RPG | `turns` |
| Phases and timers that survive a big-screen reload | every game | `phases`: deadline-based, saved with `party.save` |
| A camera that follows the action; fog of war | platformers, RPGs | `ascii` gains a view and fog |
| 3-2-1 countdowns, rankings with ties, dice, player colours | most games | small utilities |

**Plan:**
1. **Baseline first.** Three ideas built from FIXED approved designs (the racing platformer,
   The Long Road, and a turn-based board game), in variants **A** (as today) and **B**
   (today minus the example game's code). Compare: passed or not, attempts, time, tokens,
   code size, hand-written machinery left, and a playability look at the screenshots. One
   run each: a strong hint, not proof.
2. **Build the helpers** (`vote`, `turns`, `phases`, the `ascii` view and fog, `platformer`,
   the small utilities), each tested in the UI Demo game, each with a short entry in the
   rulebook (~100 tokens; ~1,000 in all, a sixth of the example game).
3. **Variant C** (new helpers, no example game) on the same designs; compare with A and B and
   decide whether the example game stays in the build step.

**Results (2026-10-16, qwen3.8:27b, one run per cell; files in `generator/out/helpers-exp/`):**

| Variant | What the AI got | Build prompt | Passed | 1st try | Total time | Code size |
|---|---|---|---|---|---|---|
| A | as before (with example game) | 12–15.5K tokens | 3/3 | 2/3 | 811 s | 16.5 / 28.6 / 25.7 KB |
| B | no example game | ~7K | 3/3 | 1/3 | 1,380 s | 21.7 / 25.1 / 23.5 KB |
| C | no example game, `party.kit` | ~8K | 3/3 | 0/3 | 1,455 s | 13.4 / 21.2 / 22.0 KB |
| C2 | C again, fixed checker + camelCase rule | ~8K | 3/3 | **3/3** | **745 s** | 13.7 / 27.5 / 27.0 KB |

(Sizes: platformer / RPG / board.)

- **The failed first tries were mostly not the game's fault.** 4 were `style:{flex-direction:…}`
  (a syntax error: fixed by the camelCase line in the rulebook) and 3 were the static check's
  false alarm on a game's own `top` variable (fixed in the checker). Two real bugs were left:
  A-board had a plain syntax slip ("missing )"), and
  C-rpg drew `party.ui.ascii('#map')` before making `#map`. A, B and C ran on the old checker
  and rulebook, so C2 is the only fair picture of "today".
- **Fixes are fast without the example game.** A fix attempt in B/C takes 76–158 s (the fix
  prompt is ~15K either way); a first attempt takes 160–400 s, mostly writing.
- **`party.kit` use is real but uneven.** C used it a lot (phases, votes, turns, the platformer
  world, rank). In C2 the platformer used it (platformer, phases, rank, countdown), the RPG used
  only the small utilities and wrote its own vote and phases, and the board game used none of
  it. Nothing broke where the kit was used. The rulebook entry is short; a tiny "how to use
  phases/vote/turns together" sample may be what's missing.
- **Screenshots:** all 12 games show a working screen and controls; C/C2 look as good as A. The
  RPG's 4×4 view comes from the fixed design, not the variant.

**Decision (made 2026-10-16):** drop the example game's code from the build step (`exampleGame: false`
by default). C2 matched or beat A on every measure with about half the prompt, which also
leaves more of the 65K context for fixes and bigger games. Keep the example game as an option
for retries. Next: a few more C2-style runs over time, and a short combined kit sample in the
rulebook if games keep skipping the kit.

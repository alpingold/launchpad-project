# Experiments

How BoilerGames' AI generation was tested: each file is one experiment's question, method,
numbers and findings. What was decided because of it is in [the plan](../PLAN.md), which links
here. Section numbers (§) are the plan's. Oldest first:

| File | Question | Plan |
|---|---|---|
| [model-comparisons.md](model-comparisons.md) | Which model writes the games? | §11g, §12j, §13n |
| [example-designs.md](example-designs.md) | Do example designs help, or get copied? | §13n |
| [helper-library.md](helper-library.md) | Which helpers, and does the build need the example game? | §13o |
| [party-kit.md](party-kit.md) | Does `party.kit` help? | §20 |
| [edit-mode.md](edit-mode.md) | Edits or whole files for changes and fixes? | §23 |
| [size-limit.md](size-limit.md) | Does "At most 100 KB" in the prompt change the games? | §32 |
| [length-rule.md](length-rule.md) | Does the 5–15 minute rule help? | §35 |
| [build-thinking.md](build-thinking.md) | How much should a build think, and how? | §38, §40 |
| [brief-medium.md](brief-medium.md) | The short-plan sentence, part by part | §43 |
| [code-review.md](code-review.md) | Does the AI reviewer find real bugs, and fix them? | §47 |
| [remix-design.md](remix-design.md) | A remix's big change: change loop, or its own design first? | §45b |

The games and logs themselves are in `generator/out/<name>/` on the machine that ran them (not
in git). Tools: `npm run compare-builds`, `review-builds`, `review-fix` (server/scripts).

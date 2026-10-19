# Model comparisons

Which model writes BoilerGames' games. **Decided 2026-10-14, confirmed 2026-10-15: qwen3.8:27b is
the only model** (plan §11g, §12j, §13n). Three rounds, oldest first.

## 1. Three ideas, two models (A4, 2026-10-13)

Three ideas, each generated once per model in the sandbox with `npm run generate` (six runs in parallel):

| Idea | gpt-oss:120b | qwen3.8:27b |
|---|---|---|
| Purdue trivia (5 questions, first correct = 2 points) | ✅ 1st try, 31 s | ✅ 1st try, 40 s |
| Hot Potato (pass a potato, it explodes, 2 lives) | ✅ 2nd try, 49 s | ✅ 4th try, 354 s |
| Rock paper scissors party (a point per player beaten) | ✅ 1st try, 31 s | ✅ 1st try, 68 s |

Plus "Hot or Not: Food" on gpt-oss: ✅ 1st try, 27 s.

**Takeaways:**
- Every run ended with a passing game; the check → fix loop rescued both Hot Potato runs.
- gpt-oss is much faster and needed fewer fixes here, so it stays the default.
- Both copy the example games' structure closely, so the examples are the main lever on quality.
- **The tests can't check facts or game logic.** Both trivia games contained wrong or made-up "facts": qwen marked "Blue and Gold" as Purdue's colors and *The Daily Titan* as its newspaper. "Hot or Not" awarded a "minority" point when everyone voted the same way. Human review stays essential. For fact games, put the facts in the idea yourself.
- Sample size is tiny (one run per cell); revisit with more runs if the defaults ever matter more.

## 2. Four ideas on contract v3 (K5, 2026-10-14)

Four ideas, run in the sandbox with `npm run generate` (six runs in parallel). The original drawing and reflex prompts weren't saved, so these are rewritten versions of them.

| Idea | gpt-oss:120b | qwen3.8:27b |
|---|---|---|
| Drawing: everyone draws a different silly prompt, then votes on the gallery | ✅ 1st try, 52 s | ✅ 1st try, 131 s |
| Reflex: reaction, mashing, timing bar and tap-target rounds | ✅ 2nd try, 95 s | ✅ 2nd try, 317 s |
| Guess the Number (slider) | ✅ 2nd try, 76 s | not run |
| Rank It (rank) | ✅ 1st try, 51 s | not run |

**What reading the code found** (the tests can't judge game logic):

| Game | Good | Wrong |
|---|---|---|
| Drawing, gpt-oss | drawPad, gallery, timer and progress bars | The gallery has no names or numbers, but the vote buttons say "Vote for Alex's drawing": you can't tell which drawing is whose, and votes aren't anonymous |
| Drawing, qwen | The best of the batch: numbered gallery, your own drawing left out of your vote, names revealed afterwards | Crashed when fewer than 2 players drew (an empty grid). Found by the stronger bots below |
| Reflex, gpt-oss | All 4 widgets | Mashing and tap-target rounds end at the exact moment phones send their results, so most results would be lost. The reaction widget only appears at GO, so false starts are impossible |
| Reflex, qwen | All 4 widgets used correctly: sent once, never re-sent, 1.5 s grace for late results | False starts and players with no result can still win placement points |
| Guess the Number, gpt-oss | slider, reveal grid | The slider gives the answer away: max = 2 × answer + 20, and the start value *is* the answer when it's under 50 |
| Rank It, gpt-oss | rank, average-ranking reveal | Never says what the order means (best? favorite?); the reveal's "points earned here" is always 0 (player scores read by item index) |

**Fixed because of this run:**
- **Platform:** a full drawing is up to 18 KB, so a gallery of 12 is ~220 KB, over the 96 KB screen limit. Both drawing games would have crashed at a full party. The bots only drew ~0.4 KB scribbles, so the harness never saw it. Now one bot drawing in four uses all the ink, and screens may be 256 KB.
- **Spec:** wait ~2 s after a `mash`/`tapTargets` ends before ending the round; never let a slider's range or start value depend on the answer.

**Takeaways:**
- **The kit does its job.** Every run used the block made for the idea (drawPad, all four widgets, slider, rank), and all 6 passed, 3 on the first try. Before K1, the drawing and reflex games couldn't be made at all.
- **qwen designs better games again** (fewer logic bugs, and it followed the widget rules), but it's 2–3× slower. **Decided 2026-10-14: qwen3.8:27b is the only model; gpt-oss:120b is dropped.** Better games are worth a few minutes' wait, especially with a good spec. The admin page shows the model instead of a picker; adding one back is a line in `generator/src/models.js`.
- **Passing the tests ≠ a good game.** Every gpt-oss game had a logic or design bug that only reading or playtesting finds. That's what K6's "ask for changes" is for: describe the bug, get a new version.
- The bots matter as much as the checks: a test is only as good as the inputs it tries.

## 3. Four models on frame games (2026-10-15)

**Model comparison, 2026-10-15** (`generator/out/compare/`, not in git). Same two ideas
(the racing platformer, the RPG). Each model wrote its own design, and built from the SAME
approved designs qwen built from. qwen's builds are from earlier the same day.

| Model (context) | Design: time, quality | Platformer build | RPG build |
|---|---|---|---|
| qwen3.8:27b (65K) | 36–65 s; concrete, numbers and arithmetic, ~5–6.5 min games | passed, attempt 1 (~5 min); full, playable | passed, attempt 2 (~7 min); 12×12 map with fog, rich |
| gpt-oss:120b (65K) | 11–16 s; detailed, longest | passed, attempt 2 (104 s); **barely visible track, no players drawn** | passed, attempt 4 (209 s); **party stuck at the start** ("can't go" every way) |
| gemma4:26b-a4b (65K) | 6–7 s; short and vague in places | **failed**: the same syntax error 4 times | passed, attempt 1 (94 s); clean, playable |
| llama4:latest (16K) | 11–12 s; vague, no numbers, ignores the rules (2–12 players, 45–60 min) | **failed**: context full after attempt 1 | **failed**: context full after attempt 1 |

- **The checks pass games that are broken to a player** (gpt-oss's two). "Not blank" isn't
  "playable": a check that players actually move or appear would catch these.
- **The fix loop now stays flat:** gpt-oss's 4 RPG attempts each sent ~19.5K tokens (before
  the change, attempt 4 would have sent ~45K).
- **llama4's 16K context can't hold a build** (prompt ~11–15K tokens + the game).
- Conclusion so far: qwen makes the best games but is slowest; gemma4 is fast and sometimes
  good but unreliable; gpt-oss is fast with lower quality; llama4 is out for building.
  **Decided (2026-10-15): qwen3.8:27b stays the only model.**

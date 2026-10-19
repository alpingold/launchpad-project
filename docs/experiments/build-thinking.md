# Thinking at build time: reasoning effort and the short plan (2026-10-18)

Plan §38, §40. **Decided: medium for every step, and a new game's build asks for a short plan
first** (`BRIEF_THINKING` in generator/src/prompt.js).

## Reasoning effort (§38)

- **Every request now sends `reasoning_effort: "medium"`** (per model, in `models.js`).
  GenAI Studio's vLLM takes `low`, `medium` or `xhigh` for qwen3.8:27b; `xhigh` is the
  default. In Qwen's chat template the levels are just a sentence added to the system prompt:
  xhigh asks it to "think carefully … validate key assumptions, consider plausible
  alternatives", low to "keep your thinking brief", and medium adds nothing.
- **Measured once each on a logic puzzle:** low thought ~3× less (19 s vs ~40–60 s); medium
  and xhigh were within run-to-run noise. All got it right. `none` is a trap: no separate
  thinking, so it reasons in the visible answer (slowest run, most tokens).
- **`chat_template_kwargs` reach the template** (`enable_thinking: false` turned thinking
  off), but our requests have no tools, images or saved thinking, so the template fixes in
  froggeric/Qwen-Fixed-Chat-Templates mostly don't apply. Purdue picks the template.
- **`keepThinking`** (a job option, off on the site) saves the model's thinking per attempt;
  `compare-builds` writes it to `attempt-<n>-thinking.txt`, to see what builds think about.
- **What it showed:** a Ballpark build thought for 46,540 tokens (36% of it drafts of code, 78
  "Actually"s) and used 64,590 of the 65,536-token context; a Comet Crew build ran out twice.
  So **running out of room** is now its own error (`OutOfRoomError`: `finish_reason` "length",
  or thinking and no reply), not "empty reply (often the rate limit)". It isn't retried inside
  `chat`; a build counts it as a used attempt (`outOfRoom: true`, with its tokens and thinking).

## Medium, medium with a short plan, or low (§40)

- **The problem:** a first build at medium thought for 25–58K tokens (Ballpark 46.5K; about a
  third of it drafts of code, plus "Actually" ×78 and "Let me write" ×61) and ran out of room
  in the 65K context 3 times on Comet Crew.
- **Tried on Comet Crew** (`compare-builds`, 2–3 builds a side, two at a time with `--parallel`):
  | First build | Builds | Passed | Out of room | First-attempt thinking |
  |---|---|---|---|---|
  | medium (plain) | 2 | 1 | 2 (in one build) | 24.7K, then 58.6K ×2 |
  | medium + short plan | 5 | 4 | 0 | 2.2–11.6K |
  | low | 3 | 3 | 0 | 6.0–22.5K |
- **Chosen: medium for every step, and a new game's build asks for a short plan first**
  (`BRIEF_THINKING` in prompt.js, `briefThinking` on by default): *plan the big screen's state,
  what each phone is sent, every timer, leaving and reloads; work out only the tricky parts;
  where the design is unclear, follow the reading closest to its words.* Effort is set per
  step in models.js (`design`, `build`, `fix`), so a step can change on its own later.
- **Low wasn't better:** its thinking varied more (up to 22.5K) and its games had as many bugs.
- **What the checks missed:** low-3 and medium-brief-2 both "passed on the first try" but never
  leave their first screen: they set the intro's timer and nothing ever starts a wave. Nothing
  runs, so nothing crashes. A playtest check that the game moves on is next (§41).
- **`party.sound`:** models wrote `party.sound` (or a bare `sound`) in 3 of 11 builds, because
  everything else a game does is `party.something`. It's now `party.sound` in the SDK, the
  rulebook and /kit; `party.ui.sound` is the same function, for older games.
- **Tools for this** (local, off on the site): `keepThinking` saves each attempt's thinking,
  reply and any tool calls, and reports attempts as they end (a stopped `compare-builds` keeps
  them); a job may set `reasoningEffort` for all its steps; every attempt records
  `finishReason`. One build's file was cut off mid-line (brief-2); none since, all `stop`.

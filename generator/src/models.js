// The models the generator may use (Purdue GenAI Studio ids). One for now: qwen made the
// better games in both comparisons (plan §11g, §12j), and on 2026-10-14 we decided that's
// worth its slower runs (about 2–5 minutes per game). gpt-oss:120b was dropped.
// The list stays a list, so trying another model later is one line here.
// 2026-10-15: compared again on frame games against gpt-oss:120b, gemma4:26b-a4b and
// llama4:latest (plan §13n): qwen made the best games by a clear margin, so it stays the
// only one. (llama4's 16K context can't even hold a build.)
// reasoningEffort (2026-10-18): sent with every request. qwen takes low, medium or xhigh, and
// GenAI Studio's default is xhigh, which adds "think carefully through the task..." to the
// system prompt; medium adds nothing (plan §38).
export const MODELS = Object.freeze([
  { id: 'qwen3.8:27b', reasoningEffort: 'medium', note: 'thinks before it writes: about 1–5 minutes per attempt' },
]);

export const DEFAULT_MODEL = MODELS[0].id;

export const isAllowedModel = (id) => MODELS.some((m) => m.id === id);

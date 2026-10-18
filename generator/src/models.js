// The models the generator may use (Purdue GenAI Studio ids). One for now: qwen made the
// better games in both comparisons (plan §11g, §12j), and on 2026-10-14 we decided that's
// worth its slower runs (about 2–5 minutes per game). gpt-oss:120b was dropped.
// The list stays a list, so trying another model later is one line here.
// 2026-10-15: compared again on frame games against gpt-oss:120b, gemma4:26b-a4b and
// llama4:latest (plan §13n): qwen made the best games by a clear margin, so it stays the
// only one. (llama4's 16K context can't even hold a build.)
// reasoningEffort (2026-10-18): how much the model thinks, per step. qwen takes low, medium or
// xhigh; GenAI Studio's default is xhigh (plan §38). All medium for now: a first build at
// medium could think until the 65K context was full, so it also gets BRIEF_THINKING (prompt.js),
// which kept it short; low was tried for first builds and made no better games (plan §40).
export const MODELS = Object.freeze([
  {
    id: 'qwen3.8:27b',
    reasoningEffort: Object.freeze({ design: 'medium', build: 'medium', fix: 'medium' }),
    note: 'thinks before it writes: about 1–5 minutes per attempt',
  },
]);

export const DEFAULT_MODEL = MODELS[0].id;

export const isAllowedModel = (id) => MODELS.some((m) => m.id === id);

/**
 * How much `model` thinks for one step: 'design' (a design or change plan), 'build' (the
 * first request for a game file) or 'fix' (every request after it).
 * @param {string} model
 * @param {'design' | 'build' | 'fix'} step
 * @returns {string | undefined}
 */
export const reasoningEffortFor = (model, step) => MODELS.find((m) => m.id === model)?.reasoningEffort?.[step];

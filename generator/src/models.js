// The models the generator may use (Purdue GenAI Studio ids). One for now: qwen made the
// better games in both comparisons (plan §11g, §12j), and on 2026-10-14 we decided that's
// worth its slower runs (about 2–5 minutes per game). gpt-oss:120b was dropped.
// The list stays a list, so trying another model later is one line here.
export const MODELS = Object.freeze([
  { id: 'qwen3.8:27b', note: 'thinks before it writes: about 1–3 minutes per attempt' },
]);

export const DEFAULT_MODEL = MODELS[0].id;

export const isAllowedModel = (id) => MODELS.some((m) => m.id === id);

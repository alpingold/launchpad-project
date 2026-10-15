// The models the generator may use (Purdue GenAI Studio ids). One for now: qwen made the
// better games in both comparisons (plan §11g, §12j), and on 2026-10-14 we decided that's
// worth its slower runs (about 2–5 minutes per game). gpt-oss:120b was dropped.
// The list stays a list, so trying another model later is one line here.
// 2026-10-15: three more are allowed again, for a comparison on frame games (plan §13n).
// Context limits are RCAC's (docs.rcac.purdue.edu/services/genai/models).
export const MODELS = Object.freeze([
  { id: 'qwen3.8:27b', note: 'thinks before it writes: about 1–3 minutes per attempt' },
  { id: 'gpt-oss:120b', note: 'fast; 65K context' },
  { id: 'gemma4:26b-a4b', note: 'fast (4B active parameters); 65K context' },
  { id: 'llama4:latest', note: '16K context: likely too small for building a game' },
]);

export const DEFAULT_MODEL = MODELS[0].id;

export const isAllowedModel = (id) => MODELS.some((m) => m.id === id);

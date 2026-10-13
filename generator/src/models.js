// The models the generator may use (Purdue GenAI Studio ids). Chosen 2026-10-13 from an
// informal test (generator/README.md); the list is short on purpose.
export const MODELS = Object.freeze([
  { id: 'gpt-oss:120b', note: 'default: fast (about 25 s per attempt)' },
  { id: 'qwen3.8:27b', note: 'generally makes better games, but much slower (about 150 s per attempt)' },
]);

export const DEFAULT_MODEL = MODELS[0].id;

export const isAllowedModel = (id) => MODELS.some((m) => m.id === id);

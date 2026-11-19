/**
 * The model the server uses with GENAI_BASE_URL=fake: development and the browser tests, never
 * production (config.ts refuses it there). It reaches nothing. GenAI Studio's key check says every
 * key is valid except one, so a test can see a refusal.
 */
import { ScriptedModel } from "./fake-model.js";

/** The one key the fake GenAI Studio refuses. */
export const FAKE_REJECTED_KEY = "rejected-key-0000";

export function devFakeModel(): ScriptedModel {
  return new ScriptedModel([], { rejectedKeys: [FAKE_REJECTED_KEY] });
}

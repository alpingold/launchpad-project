/**
 * The AI maker's side of the site's API (server/src/generations/): a Creator's GenAI Studio key. Once
 * saved, the key never comes back from the site: only whether one is saved and its last 4 characters.
 */
import { del, get, put } from "../account/account-api.js";

export interface KeyStatus {
  readonly saved: boolean;
  readonly last4?: string;
  readonly savedAt?: number;
}

const KEY_PATH = "/api/my/genai-key";

export const keyStatus = () => get<KeyStatus>(KEY_PATH);
export const saveKey = (key: string) => put<KeyStatus>(KEY_PATH, { key });
export const deleteKey = () => del<KeyStatus>(KEY_PATH);

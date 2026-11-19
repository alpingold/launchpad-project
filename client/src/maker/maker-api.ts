/**
 * The AI maker's side of the site's API (server/src/generations/): a Creator's GenAI Studio key. Once
 * saved, the key never comes back from the site: only whether one is saved and its last 4 characters.
 */
import { del, get, post, put } from "../account/account-api.js";

export interface KeyStatus {
  readonly saved: boolean;
  readonly last4?: string;
  readonly savedAt?: number;
  /** False when the site can no longer decrypt it (its secret was lost): save it again. */
  readonly usable?: false;
}

const KEY_PATH = "/api/my/genai-key";

export const keyStatus = () => get<KeyStatus>(KEY_PATH);
export const saveKey = (key: string) => put<KeyStatus>(KEY_PATH, { key });
export const deleteKey = () => del<KeyStatus>(KEY_PATH);

// --- Generations: an idea made into a Game by the site's AI (server/src/generations/generation-routes.ts).

export type GenerationState = "concept" | "review" | "build" | "playtest" | "ready" | "failed" | "cancelled";

export interface ConceptPhase {
  readonly id: string;
  readonly name: string;
  readonly screen: string;
  readonly phone: string;
  readonly ends: string;
}

/** A Concept: the design of a whole Game, before any code. The server checks every field. */
export interface Concept {
  readonly title: string;
  readonly pitch: string;
  readonly players: { readonly min: number; readonly max: number };
  readonly phases: readonly ConceptPhase[];
  readonly scoring: { readonly kind: "none" | "points" | "winner"; readonly how: string };
  readonly length: string;
  readonly look: unknown;
}

export interface Problem {
  readonly stage: string;
  readonly message: string;
  readonly line?: number;
}

export interface Step {
  readonly number: number;
  readonly kind: "concept" | "build" | "typeFix" | "playtest";
  readonly beganAt: number;
  readonly endedAt: number | null;
  readonly outcome: string | null;
  readonly problems: readonly Problem[] | null;
}

export interface Generation {
  readonly id: string;
  readonly state: GenerationState;
  readonly idea: string;
  readonly concept: Concept | null;
  readonly reason: string | null;
  readonly waiting: { readonly why: "rateLimited" | "unavailable"; readonly until: number } | null;
  readonly place: number | null;
  readonly builds: number;
  readonly modelCalls: number;
  readonly gameId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly steps?: readonly Step[];
}

/** The most an idea may be, in characters (the server's MAX_IDEA_CHARS). */
export const MAX_IDEA_CHARS = 2_000;
/** The most a note asking for a new draft may be (the server's MAX_REQUEST_CHARS). */
export const MAX_NOTE_CHARS = 1_000;

const GENERATIONS_PATH = "/api/my/generations";
const one = (id: string) => `${GENERATIONS_PATH}/${encodeURIComponent(id)}`;

export const myGenerations = () => get<Generation[]>(GENERATIONS_PATH);
export const generation = (id: string) => get<Generation>(one(id));
export const startGeneration = (idea: string) => post<Generation>(GENERATIONS_PATH, { idea });
export const editConcept = (id: string, concept: Concept) => put<Generation>(`${one(id)}/concept`, { concept });
export const redraft = (id: string, note: string) => post<Generation>(`${one(id)}/redraft`, { note });
export const approve = (id: string, concept?: Concept) => post<Generation>(`${one(id)}/approve`, concept === undefined ? {} : { concept });
export const cancelGeneration = (id: string) => post<Generation>(`${one(id)}/cancel`, {});

/** Whether the AI is working on it (or it waits its turn): the page asks again every few seconds only then. */
export const working = (state: GenerationState) => state === "concept" || state === "build" || state === "playtest";

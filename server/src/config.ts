/**
 * The server's settings from environment variables, read in one place so they can be tested.
 */
import { childProcessRunner, socketRunner, type PlaytestRunner } from "@boilergames/playtest/client";
import { IN_MEMORY } from "./db/database.js";
import { devFakeModel } from "./generations/dev-fake.js";
import { genaiModel, type Model } from "./generations/model.js";
import { DEFAULT_MAX_ROOMS } from "./rooms.js";

/** How many Rooms may be open at once: MAX_ROOMS, a whole number above 0, or DEFAULT_MAX_ROOMS if unset. */
export function maxRoomsFrom(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env["MAX_ROOMS"];
  if (raw === undefined || raw === "") return DEFAULT_MAX_ROOMS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`MAX_ROOMS must be a whole number above 0, not "${raw}"`);
  return value;
}

/**
 * Where the database lives: DATABASE_FILE. Without it, a database in memory, which is forgotten when
 * the server stops: fine while developing and testing, never in production (NODE_ENV=production),
 * where it is refused. A site that quietly forgot every account on restart is worse than one that
 * is down.
 */
export function databaseFileFrom(env: Readonly<Record<string, string | undefined>>): string {
  const file = env["DATABASE_FILE"];
  if (file !== undefined && file !== "") return file;
  if (env["NODE_ENV"] === "production") throw new Error("DATABASE_FILE must be set in production: without it every account would be forgotten on restart");
  return IN_MEMORY;
}

/**
 * How the server runs a Playtest. With PLAYTEST_SOCKET, through that socket: systemd starts each
 * runner inside its wall (deploy/boilergames-playtest@.service). Without it, a child process,
 * which has NO WALL: the Game's code would run as the site's own user, so that is for development
 * and tests only. In production without PLAYTEST_SOCKET there is no Playtest at all (null), and
 * Uploads are refused, rather than ever running a stranger's code unwalled.
 */
export function playtestFrom(env: Readonly<Record<string, string | undefined>>): PlaytestRunner | null {
  const socket = env["PLAYTEST_SOCKET"];
  if (socket !== undefined && socket !== "") return socketRunner(socket);
  if (env["NODE_ENV"] === "production") return null;
  return childProcessRunner();
}

/**
 * Which model the AI maker talks to, as MAIL chooses how email is sent:
 * - GENAI_BASE_URL and GENAI_MODEL unset: none. The AI maker is off, its pages say so and its routes
 *   answer "not available". A release starts this way.
 * - GENAI_BASE_URL=fake: the scripted fake, for development and the browser tests. Refused in
 *   production.
 * - GENAI_BASE_URL=<address> with GENAI_MODEL: GenAI Studio. In production the address must be
 *   https, or a mistyped setting would send Creators' keys unprotected.
 * Anything else stops the server from starting, so a mistake is seen at once.
 */
export function modelFrom(env: Readonly<Record<string, string | undefined>>): Model | null {
  const base = env["GENAI_BASE_URL"] ?? "";
  const model = env["GENAI_MODEL"] ?? "";
  const production = env["NODE_ENV"] === "production";
  if (base === "" && model === "") return null;
  if (base === "fake") {
    if (production) throw new Error("GENAI_BASE_URL=fake is for development and tests: production must use GenAI Studio, or leave it unset");
    return devFakeModel();
  }
  if (base === "" || model === "") throw new Error("GENAI_BASE_URL and GENAI_MODEL go together: set both, or neither to leave the AI maker off");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`GENAI_BASE_URL must be an address, not "${base}"`);
  }
  if (url.protocol !== "https:" && (production || url.protocol !== "http:")) {
    throw new Error(`GENAI_BASE_URL must be an https address${production ? " in production" : ""}, not "${base}"`);
  }
  return genaiModel({ baseUrl: base, model });
}

/**
 * The server's settings from environment variables, read in one place so they can be tested.
 */
import { IN_MEMORY } from "./db/database.js";
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

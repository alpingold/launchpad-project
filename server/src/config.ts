/**
 * The server's settings from environment variables, read in one place so they can be tested.
 */
import { DEFAULT_MAX_ROOMS } from "./rooms.js";

/** How many Rooms may be open at once: MAX_ROOMS, a whole number above 0, or DEFAULT_MAX_ROOMS if unset. */
export function maxRoomsFrom(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env["MAX_ROOMS"];
  if (raw === undefined || raw === "") return DEFAULT_MAX_ROOMS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`MAX_ROOMS must be a whole number above 0, not "${raw}"`);
  return value;
}

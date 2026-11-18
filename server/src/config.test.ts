// The server's settings from the environment, and that the README says what the code does.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { databaseFileFrom, maxRoomsFrom, playtestFrom } from "./config.js";
import { IN_MEMORY } from "./db/database.js";
import { DEFAULT_MAX_ROOMS } from "./rooms.js";

test("MAX_ROOMS is read from the environment, and refused unless it is a whole number above 0", () => {
  expect(maxRoomsFrom({ MAX_ROOMS: "12" })).toBe(12);
  for (const bad of ["0", "-3", "2.5", "lots"]) expect(() => maxRoomsFrom({ MAX_ROOMS: bad }), bad).toThrow(/MAX_ROOMS/);
});

test("without MAX_ROOMS, the default is 30, as the README says", () => {
  expect(maxRoomsFrom({})).toBe(DEFAULT_MAX_ROOMS);
  expect(DEFAULT_MAX_ROOMS).toBe(30);
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  expect(readme).toContain(`\`MAX_ROOMS\` (${DEFAULT_MAX_ROOMS})`);
});

test("DATABASE_FILE names the database; without it, one in memory, except in production", () => {
  expect(databaseFileFrom({ DATABASE_FILE: "/var/lib/boilergames/site.db" })).toBe("/var/lib/boilergames/site.db");
  expect(databaseFileFrom({})).toBe(IN_MEMORY);
  expect(databaseFileFrom({ NODE_ENV: "development" })).toBe(IN_MEMORY);
  expect(() => databaseFileFrom({ NODE_ENV: "production" })).toThrow(/DATABASE_FILE must be set in production/);
  expect(() => databaseFileFrom({ NODE_ENV: "production", DATABASE_FILE: "" })).toThrow(/DATABASE_FILE/);
});

test("the Playtest goes through PLAYTEST_SOCKET when set; never unwalled in production", () => {
  expect(playtestFrom({ PLAYTEST_SOCKET: "/run/boilergames-playtest.sock", NODE_ENV: "production" })).not.toBeNull();
  expect(playtestFrom({ NODE_ENV: "production" })).toBeNull();
  // Development and tests: a child process, with no wall.
  expect(playtestFrom({})).not.toBeNull();
});

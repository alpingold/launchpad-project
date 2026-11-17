// The server's settings from the environment, and that the README says what the code does.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { maxRoomsFrom } from "./config.js";
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

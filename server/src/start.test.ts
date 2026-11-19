// Starting the whole server from its settings, as main.ts does with process.env.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { start } from "./start.js";

const ports = { PORT: "0", FRAME_PORT: "0", HOST: "127.0.0.1" };

test("in production without DATABASE_FILE, the server refuses to start and listens on nothing", async () => {
  await expect(start({ ...ports, NODE_ENV: "production" })).rejects.toThrow(/DATABASE_FILE must be set in production/);
});

test("in production without MAIL=ses, or with a MAIL it doesn't know, the server refuses to start", async () => {
  await expect(start({ ...ports, NODE_ENV: "production", DATABASE_FILE: "/nowhere/site.db" })).rejects.toThrow(/MAIL=ses must be set in production/);
  await expect(start({ ...ports, MAIL: "carrier-pigeon" })).rejects.toThrow(/MAIL must be "ses" or unset/);
});

test("in production with the fake model, or a model address that isn't https, the server refuses to start", async () => {
  const production = { ...ports, NODE_ENV: "production", DATABASE_FILE: "/nowhere/site.db", MAIL: "ses" };
  await expect(start({ ...production, GENAI_BASE_URL: "fake" })).rejects.toThrow(/GENAI_BASE_URL=fake is for development/);
  await expect(start({ ...production, GENAI_BASE_URL: "http://genai.example/api", GENAI_MODEL: "m" })).rejects.toThrow(/must be an https address in production/);
});

test("with DATABASE_FILE, the server makes the database there, brings it up to date and answers", async () => {
  const folder = mkdtempSync(join(tmpdir(), "start-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const file = join(folder, "site.db");
    const server = await start({ ...ports, NODE_ENV: "production", MAIL: "ses", DATABASE_FILE: file });
    try {
      expect(existsSync(file)).toBe(true);
      expect(log).toHaveBeenCalledWith("Database: applied 0002-games.sql");
      expect((await fetch(`http://127.0.0.1:${server.port}/api/config`)).status).toBe(200);
    } finally {
      await server.close();
    }
  } finally {
    log.mockRestore();
    warn.mockRestore();
    rmSync(folder, { recursive: true, force: true });
  }
});

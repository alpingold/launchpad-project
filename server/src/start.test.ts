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

test("with DATABASE_FILE, the server makes the database there, brings it up to date and answers", async () => {
  const folder = mkdtempSync(join(tmpdir(), "start-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const file = join(folder, "site.db");
    const server = await start({ ...ports, NODE_ENV: "production", DATABASE_FILE: file });
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

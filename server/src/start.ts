/**
 * Starts the whole server from its settings (environment variables): the database, the site and
 * the game domain. main.ts calls it with process.env; a test can call it with its own.
 *
 * Two origins: the site, and the game domain that serves only the Game frame (ADR 0004). In
 * development the game domain is the next port up.
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { databaseFileFrom, maxRoomsFrom, playtestFrom } from "./config.js";
import { IN_MEMORY, openDatabase } from "./db/database.js";
import { createFrameServer, createServer, forwardedAddress } from "./index.js";
import { mailFrom } from "./mail.js";

type Settings = Readonly<Record<string, string | undefined>>;

export interface Started {
  /** The ports actually listened on (a setting of 0 picks a free one). */
  readonly port: number;
  readonly framePort: number;
  readonly close: () => Promise<void>;
}

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Opens the database and starts listening. Rejects, having started nothing, if a setting is wrong or
 * the database can't be brought up to date: no DATABASE_FILE or no MAIL=ses in production, or a
 * migration that fails. Then the server doesn't run at all, which systemd and the release's health check see.
 */
export async function start(env: Settings): Promise<Started> {
  const port = Number(env["PORT"] ?? 3000);
  // Only this computer, unless told otherwise: `npm run dev -- --lan` sets HOST=0.0.0.0 so phones on
  // the same network can reach it. Behind Caddy in production, localhost is right too.
  const host = env["HOST"] ?? "localhost";
  const framePort = Number(env["FRAME_PORT"] ?? port + 1);
  const siteOrigin = env["SITE_ORIGIN"] ?? `http://localhost:${port}`;
  const maxRooms = maxRoomsFrom(env);

  const file = databaseFileFrom(env);
  const mail = await mailFrom(env);
  const database = openDatabase({ file });
  if (file === IN_MEMORY) console.log("Database: in memory (no DATABASE_FILE), forgotten when the server stops");

  const server = createServer({
    clientDist: here("../../client/dist"),
    gamesDist: here("../../games/dist"),
    siteOrigin,
    frameUrl: env["FRAME_URL"] ?? `http://localhost:${framePort}/v1/`,
    maxRooms,
    database,
    mail,
    playtest: playtestFrom(env),
    // Behind Caddy every request comes from 127.0.0.1; the phone's own address is in X-Forwarded-For.
    ...(env["TRUST_PROXY"] === "1" ? { addressOf: forwardedAddress } : {}),
  });
  const frame = createFrameServer({ root: here("../../client/dist-frame"), siteOrigin });
  const listen = (on: Server, at: number) => new Promise<number>((resolve, reject) => {
    on.once("error", reject);
    on.listen(at, host, () => resolve((on.address() as AddressInfo).port));
  });
  const [sitePort, gamePort] = await Promise.all([listen(server.http, port), listen(frame, framePort)]);
  console.log(`Server listening on ${host}:${sitePort}, for the site at ${siteOrigin}`);
  console.log(`Game frame served on ${host}:${gamePort}`);
  return {
    port: sitePort,
    framePort: gamePort,
    async close() {
      await server.close();
      frame.closeAllConnections();
      await new Promise<void>((resolve) => frame.close(() => resolve()));
      database.close();
    },
  };
}

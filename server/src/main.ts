// Starts the server: `npm start` in production, `npm run dev` at the root while developing.
// Two origins: the site, and the game domain that serves only the Game frame (ADR 0004). In
// development the game domain is the next port up.
import { fileURLToPath } from "node:url";
import { maxRoomsFrom } from "./config.js";
import { createFrameServer, createServer, forwardedAddress } from "./index.js";

const port = Number(process.env.PORT ?? 3000);
// Only this computer, unless told otherwise: `npm run dev -- --lan` sets HOST=0.0.0.0 so phones on
// the same network can reach it. Behind Caddy in production, localhost is right too.
const host = process.env.HOST ?? "localhost";
const framePort = Number(process.env.FRAME_PORT ?? port + 1);
const siteOrigin = process.env.SITE_ORIGIN ?? `http://localhost:${port}`;
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const maxRooms = maxRoomsFrom(process.env);

const server = createServer({
  clientDist: here("../../client/dist"),
  gamesDist: here("../../games/dist"),
  siteOrigin,
  frameUrl: process.env.FRAME_URL ?? `http://localhost:${framePort}/v1/`,
  maxRooms,
  // Behind Caddy every request comes from 127.0.0.1; the phone's own address is in X-Forwarded-For.
  ...(process.env.TRUST_PROXY === "1" ? { addressOf: forwardedAddress } : {}),
});
server.http.listen(port, host, () => {
  console.log(`Server listening on ${host}:${port}, for the site at ${siteOrigin}`);
});
createFrameServer({ root: here("../../client/dist-frame"), siteOrigin }).listen(framePort, host, () => {
  console.log(`Game frame served on ${host}:${framePort}`);
});

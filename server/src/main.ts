// Starts the server: `npm start` in production, `npm run dev` at the root while developing.
// Two origins: the site, and the game domain that serves only the Game frame (ADR 0004). In
// development the game domain is the next port up.
import { fileURLToPath } from "node:url";
import { createFrameServer, createServer, forwardedAddress } from "./index.js";

const port = Number(process.env.PORT ?? 3000);
const framePort = Number(process.env.FRAME_PORT ?? port + 1);
const siteOrigin = process.env.SITE_ORIGIN ?? `http://localhost:${port}`;
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const maxRooms = process.env.MAX_ROOMS === undefined ? undefined : Number(process.env.MAX_ROOMS);
if (maxRooms !== undefined && !(Number.isInteger(maxRooms) && maxRooms > 0)) throw new Error(`MAX_ROOMS must be a whole number above 0, not "${process.env.MAX_ROOMS}"`);

const server = createServer({
  clientDist: here("../../client/dist"),
  gamesDist: here("../../games/dist"),
  siteOrigin,
  ...(maxRooms === undefined ? {} : { maxRooms }),
  // Behind Caddy every request comes from 127.0.0.1; the phone's own address is in X-Forwarded-For.
  ...(process.env.TRUST_PROXY === "1" ? { addressOf: forwardedAddress } : {}),
});
server.http.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
createFrameServer({ root: here("../../client/dist-frame"), siteOrigin }).listen(framePort, () => {
  console.log(`Game frame served on http://localhost:${framePort}/v1/`);
});

// Starts the server: `npm start` in production, `npm run dev` at the root while developing.
// Two origins: the site, and the game domain that serves only the Game frame (ADR 0004). In
// development the game domain is the next port up.
import { fileURLToPath } from "node:url";
import { createFrameServer, createServer } from "./index.js";

const port = Number(process.env.PORT ?? 3000);
const framePort = Number(process.env.FRAME_PORT ?? port + 1);
const siteOrigin = process.env.SITE_ORIGIN ?? `http://localhost:${port}`;
const frameRoot = fileURLToPath(new URL("../../client/dist/frame", import.meta.url));

createServer().listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
createFrameServer({ root: frameRoot, siteOrigin }).listen(framePort, () => {
  console.log(`Game frame served on http://localhost:${framePort}/v1/`);
});

// Starts the server: `npm start` in production, `npm run dev` at the root while developing.
// Everything it does is in start.ts; this file only hands it the settings and stops the process if
// it can't start.
import { start } from "./start.js";

try {
  await start(process.env);
} catch (error) {
  console.error(`The server can't start: ${(error as Error).message}`);
  process.exit(1);
}

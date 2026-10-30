// Starts the server: `npm start` in production, `npm run dev` at the root while developing.
import { createServer } from "./index.js";

const port = Number(process.env.PORT ?? 3000);

createServer().listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

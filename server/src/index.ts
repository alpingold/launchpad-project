import { createServer as createHttpServer, type Server } from "node:http";

// Placeholder until the real server (Express, ws) arrives: answers every request with its name.
export function createServer(): Server {
  return createHttpServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("BoilerGames server");
  });
}
export { createFrameServer, frameContentSecurityPolicy, type FrameServerOptions } from "./frame-origin.js";

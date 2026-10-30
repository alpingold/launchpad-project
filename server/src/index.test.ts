import type { AddressInfo } from "node:net";
import { afterEach, expect, test } from "vitest";
import { createServer } from "./index.js";

const server = createServer();

afterEach(() => {
  server.close();
});

test("the server answers over real HTTP", async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const response = await fetch(`http://127.0.0.1:${port}/`);

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("BoilerGames server");
});

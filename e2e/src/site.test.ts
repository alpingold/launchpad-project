import type { AddressInfo } from "node:net";
import { createServer } from "@boilergames/server";
import { siteName } from "@boilergames/shared";
import { afterEach, expect, test } from "vitest";

// A placeholder until the browser tests arrive: it proves e2e reaches the server and shared by
// their package names.
const server = createServer();

afterEach(() => {
  server.close();
});

test("the site names itself", async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const response = await fetch(`http://127.0.0.1:${port}/`);

  expect(await response.text()).toContain(siteName);
});

// Where a socket comes from, for the join limit, when the server runs behind a proxy.
import type { IncomingMessage } from "node:http";
import { expect, test } from "vitest";
import { forwardedAddress } from "./index.js";

const request = (header: string | undefined, socket = "127.0.0.1") =>
  ({ headers: header === undefined ? {} : { "x-forwarded-for": header }, socket: { remoteAddress: socket } }) as unknown as IncomingMessage;

test("takes the last X-Forwarded-For entry, the one the proxy added, not any a phone wrote itself", () => {
  expect(forwardedAddress(request("203.0.113.9"))).toBe("203.0.113.9");
  expect(forwardedAddress(request("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9");
  expect(forwardedAddress(request(undefined))).toBe("127.0.0.1");
});

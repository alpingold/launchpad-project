// Where a socket comes from, for the join limit, when the server runs behind a proxy.
import type { IncomingMessage } from "node:http";
import { describe, expect, test } from "vitest";
import { forwardedAddress } from "./index.js";

/** A request as Node hands it to the server: Caddy's connection on 127.0.0.1, and its header. */
const request = (header: string | undefined, socket = "127.0.0.1") =>
  ({ headers: header === undefined ? {} : { "x-forwarded-for": header }, socket: { remoteAddress: socket } }) as unknown as IncomingMessage;

test("takes the last X-Forwarded-For entry, the one the proxy added, not any a phone wrote itself", () => {
  expect(forwardedAddress(request("203.0.113.9"))).toBe("203.0.113.9");
  expect(forwardedAddress(request("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9");
  expect(forwardedAddress(request(undefined))).toBe("127.0.0.1");
});

// What Caddy 2.11 sends. The rule below is copied from its source (addForwardedHeaders in
// modules/caddyhttp/reverseproxy/reverseproxy.go, at v2.11.9): from a visitor it doesn't trust,
// Caddy throws away whatever X-Forwarded-For they sent and writes only the address it saw the
// connection come from; from a trusted proxy, it appends that address to what was sent. An IPv6
// address comes without brackets, port or zone. The server's Caddyfile (deploy/Caddyfile) sets no
// trusted_proxies, so to the live server's Caddy every visitor is untrusted.
function caddy(seen: string, sent: string | undefined, trusted = false): string {
  return trusted && sent !== undefined && sent !== "" ? `${sent}, ${seen}` : seen;
}

describe("behind Caddy 2.11, as the live server runs", () => {
  const visitor = "203.0.113.9";

  test("a visitor who sends no X-Forwarded-For is known by their own address", () => {
    expect(caddy(visitor, undefined)).toBe("203.0.113.9");
    expect(forwardedAddress(request(caddy(visitor, undefined)))).toBe(visitor);
  });

  test("a visitor who forges X-Forwarded-For is still known by their own address: Caddy drops the forgery", () => {
    for (const forged of ["6.6.6.6", "6.6.6.6, 7.7.7.7", "198.51.100.1, 203.0.113.9", "not an address", ""]) {
      expect(caddy(visitor, forged)).toBe("203.0.113.9");
      expect(forwardedAddress(request(caddy(visitor, forged)))).toBe(visitor);
    }
  });

  test("a visitor on IPv6 is known by their IPv6 address, forged header or not", () => {
    expect(forwardedAddress(request(caddy("2001:db8::7", "6.6.6.6")))).toBe("2001:db8::7");
  });

  test("if Caddy were told to trust a proxy in front of it, a forged entry would stay on the left, and still not count", () => {
    expect(caddy(visitor, "6.6.6.6", true)).toBe("6.6.6.6, 203.0.113.9");
    expect(forwardedAddress(request(caddy(visitor, "6.6.6.6", true)))).toBe(visitor);
    expect(forwardedAddress(request(caddy(visitor, "6.6.6.6,7.7.7.7 , 8.8.8.8", true)))).toBe(visitor);
  });
});

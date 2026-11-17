// The game domain's server: the frame's one page, with a CSP that allows exactly that page's script.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { createFrameServer, frameContentSecurityPolicy, inlineScriptHash } from "./frame-origin.js";

const SITE = "http://localhost:3000";
const servers: Server[] = [];
const roots: string[] = [];

afterAll(async () => {
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  for (const root of roots) await rm(root, { recursive: true });
});

/** A built frame folder holding a page with this script, and a server started on it. Returns its base URL. */
async function serve(script: string | null): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "frame-"));
  roots.push(root);
  await mkdir(join(root, "v1"));
  if (script !== null) await writeFile(join(root, "v1/index.html"), `<!doctype html><title>frame</title><script>${script}</script>`);
  await writeFile(join(root, "secret.txt"), "not for the game domain");
  const server = createFrameServer({ root, siteOrigin: SITE });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The hash in a CSP header's script-src. */
const hashIn = (policy: string | null) => /script-src 'sha256-([^']+)'/.exec(policy ?? "")?.[1];
/** The hash of the inline script in a served page, worked out here from the body itself. */
const hashOfServed = (html: string) => createHash("sha256").update(/<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "").digest("base64");

test("the header allows exactly the script in the page it serves, and a changed script changes the hash", async () => {
  const first = await fetch(`${await serve("console.log(1)")}/v1/`);
  const second = await fetch(`${await serve("console.log(2)")}/v1/`);
  for (const response of [first, second]) {
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(hashIn(response.headers.get("content-security-policy"))).toBe(hashOfServed(await response.clone().text()));
  }
  expect(hashIn(first.headers.get("content-security-policy"))).not.toBe(hashIn(second.headers.get("content-security-policy")));
});

test("a cached page is only ever paired with its own header: 304 for the same page, 200 with the new hash after a new build", async () => {
  const old = await serve("var v = 'old';");
  const first = await fetch(`${old}/v1/`);
  const etag = first.headers.get("etag")!;
  const policy = first.headers.get("content-security-policy");
  expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);

  // The same build: the browser may use its cached copy, and the 304's header is the one it has.
  const revalidated = await fetch(`${old}/v1/`, { headers: { "if-none-match": etag } });
  expect(revalidated.status).toBe(304);
  expect(revalidated.headers.get("content-security-policy")).toBe(policy);

  // A new build (a restarted server): the old copy's ETag no longer matches, so the new page comes
  // whole, with the hash of its own script.
  const rebuilt = await fetch(`${await serve("var v = 'new';")}/v1/`, { headers: { "if-none-match": etag } });
  expect(rebuilt.status).toBe(200);
  expect(hashIn(rebuilt.headers.get("content-security-policy"))).toBe(hashOfServed(await rebuilt.text()));
  expect(rebuilt.headers.get("content-security-policy")).not.toBe(policy);
});

test("serves nothing but the page, and even a 404 carries the walls", async () => {
  const base = await serve("1");
  const policy = (await fetch(`${base}/v1/`)).headers.get("content-security-policy");
  for (const path of ["/", "/v1/frame.js", "/secret.txt", "/v1/../secret.txt", "/v1/%2e%2e/secret.txt", "/v2/", "/api/games"]) {
    const response = await fetch(`${base}${path}`);
    expect(response.status, path).toBe(404);
    expect(response.headers.get("content-security-policy")).toBe(policy);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  }
  expect((await fetch(`${base}/v1/`, { method: "POST" })).status).toBe(404);
});

test("with no page built yet, it serves nothing and allows no script", async () => {
  const response = await fetch(`${await serve(null)}/v1/`);
  expect(response.status).toBe(404);
  expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
});

describe("the policy", () => {
  const HASH = createHash("sha256").update("x").digest("base64");

  test("allows no source that reaches a network: no 'self', no host, no http(s) or ws(s), no wildcard", () => {
    const directives = frameContentSecurityPolicy(SITE, HASH).split("; ");
    expect(directives).toEqual([
      "default-src 'none'",
      `script-src 'sha256-${HASH}'`,
      "worker-src blob:",
      "connect-src 'none'",
      "img-src 'none'",
      "font-src 'none'",
      "media-src 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "webrtc 'block'",
      "sandbox allow-scripts",
      "frame-ancestors http://localhost:3000",
    ]);
    // frame-ancestors names the site, but says who may embed the frame; it allows no request.
    const sources = directives.filter((d) => !d.startsWith("frame-ancestors ")).flatMap((d) => d.split(" ").slice(1));
    for (const source of sources) expect(source, source).toMatch(/^('none'|'sha256-[A-Za-z0-9+/]{43}='|blob:|'block'|allow-scripts)$/);
  });

  test("refuses a site origin or a hash that could smuggle in another directive", () => {
    for (const bad of ["*", "http://a.com; script-src *", "http://a.com/path", "javascript:x"]) expect(() => frameContentSecurityPolicy(bad, HASH)).toThrow();
    expect(() => frameContentSecurityPolicy(SITE, "x'; script-src *")).toThrow();
  });

  test("hashes the page's one inline script, and refuses a page with a script from a URL or more than one", () => {
    expect(inlineScriptHash("<script>x</script>")).toBe(HASH);
    expect(() => inlineScriptHash('<script src="frame.js"></script>')).toThrow();
    expect(() => inlineScriptHash("<script>a</script><script>b</script>")).toThrow();
    expect(() => inlineScriptHash("<p>no script</p>")).toThrow();
  });
});

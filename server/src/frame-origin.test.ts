// The game domain's server: the frame's two files, each with the walls in its header, and nothing else.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createFrameServer, frameContentSecurityPolicy } from "./frame-origin.js";

const SITE = "http://localhost:3000";
let root: string;
let base: string;
const server = () => servers[0]!;
const servers: ReturnType<typeof createFrameServer>[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "frame-"));
  await mkdir(join(root, "v1"));
  await writeFile(join(root, "v1/index.html"), "<!doctype html><script src=frame.js></script>");
  await writeFile(join(root, "v1/frame.js"), "/* frame */");
  await writeFile(join(root, "secret.txt"), "not for the game domain");
  servers.push(createFrameServer({ root, siteOrigin: SITE }));
  await new Promise<void>((resolve) => server().listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server().address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server().close(resolve));
  await rm(root, { recursive: true });
});

test("serves the frame's page and script, each with the Content-Security-Policy", async () => {
  for (const [path, type, body] of [
    ["/v1/", "text/html", "<!doctype html>"],
    ["/v1/index.html", "text/html", "<!doctype html>"],
    ["/v1/frame.js", "text/javascript", "/* frame */"],
  ] as const) {
    const response = await fetch(`${base}${path}`);
    expect(response.status, path).toBe(200);
    expect(response.headers.get("content-type")).toContain(type);
    expect(response.headers.get("content-security-policy")).toBe(frameContentSecurityPolicy(SITE));
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain(body);
  }
});

test("serves nothing else, and even a 404 carries the walls", async () => {
  for (const path of ["/", "/secret.txt", "/v1/../secret.txt", "/v1/%2e%2e/secret.txt", "/v2/", "/api/games"]) {
    const response = await fetch(`${base}${path}`);
    expect(response.status, path).toBe(404);
    expect(response.headers.get("content-security-policy")).toBe(frameContentSecurityPolicy(SITE));
  }
  expect((await fetch(`${base}/v1/`, { method: "POST" })).status).toBe(404);
});

describe("the policy", () => {
  test("allows no network, workers only from blob:, and only the site to embed the frame", () => {
    expect(frameContentSecurityPolicy(SITE).split("; ")).toEqual([
      "default-src 'none'",
      "script-src 'self'",
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
  });

  test("refuses a site origin that could smuggle in another directive", () => {
    for (const bad of ["*", "http://a.com; script-src *", "http://a.com/path", "javascript:x"]) expect(() => frameContentSecurityPolicy(bad)).toThrow();
  });
});

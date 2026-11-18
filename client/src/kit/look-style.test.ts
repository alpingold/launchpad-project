import { readFileSync } from "node:fs";
import type { Look } from "@boilergames/sdk/v1";
import { expect, test } from "vitest";
import { lookStyle } from "./look-style.js";

const FONT_NAMES: readonly NonNullable<Look["font"]>[] = ["plain", "rounded", "serif", "mono", "poster", "handwritten"];
const css = readFileSync(new URL("./fonts.css", import.meta.url), "utf8");
const declared = new Set([...css.matchAll(/font-family:\s*"([^"]+)"/g)].map((m) => m[1]));

test("every typeface a Look names, and each of its fallbacks, has a face in fonts.css", () => {
  for (const font of FONT_NAMES) {
    const stack = String(lookStyle({ font })["--kit-font" as keyof ReturnType<typeof lookStyle>]);
    const quoted = [...stack.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    // The typeface, a fallback for Android and one for everything else.
    expect(quoted.length, font).toBe(3);
    for (const family of quoted) expect(declared, `${font}: ${family}`).toContain(family);
  }
});

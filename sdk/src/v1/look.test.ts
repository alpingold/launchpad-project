// A Look must be readable once the site's defaults fill its gaps: text on the background and on the
// surface at 4.5 to 1 or more, the accent on the background at 3 to 1 or more (WCAG 2 contrast).
import { describe, expect, test } from "vitest";
import { checkLook, contrastRatio, DEFAULT_LOOK, MIN_ACCENT_CONTRAST, MIN_TEXT_CONTRAST, withDefaults } from "./check.js";
import type { Hex } from "./kit.js";

/** Takes `unknown` so a test can hand it what a Game author must not write, too. */
function problems(look: unknown): string[] {
  const result = checkLook(look);
  return result.ok ? [] : result.problems;
}

describe("the contrast ratio", () => {
  test("runs from 1 to 1 (the same colour) to 21 to 1 (black on white), either way round", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#3a7", "#3a7")).toBe(1);
  });

  test("matches values published for WCAG", () => {
    // #777777 on white is the well-known "just fails 4.5" grey; #767676 is the darkest that passes.
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  test("reads three-digit hex as the six-digit colour it stands for", () => {
    expect(contrastRatio("#fc0", "#000")).toBe(contrastRatio("#ffcc00", "#000000"));
    expect(contrastRatio("#ABC", "#123")).toBe(contrastRatio("#aabbcc", "#112233"));
  });

  test("black or white is always readable on any button colour, as the site's own button text assumes", () => {
    let worst = Infinity;
    for (let r = 0; r < 256; r += 5) {
      for (let g = 0; g < 256; g += 5) {
        for (let b = 0; b < 256; b += 5) {
          const color = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}` as Hex;
          worst = Math.min(worst, Math.max(contrastRatio(color, "#000000"), contrastRatio(color, "#ffffff")));
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });
});

describe("the site's default Look", () => {
  test("passes the rules it is used to fill in", () => {
    expect(checkLook(DEFAULT_LOOK)).toEqual({ ok: true, look: DEFAULT_LOOK });
    const { background, surface, text, accent } = DEFAULT_LOOK.colors;
    expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(accent, background)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
  });

  test("fills every gap in a Game's Look, and only the gaps", () => {
    expect(withDefaults(undefined)).toEqual(DEFAULT_LOOK);
    expect(withDefaults({ colors: { accent: "#e63946", text: undefined }, font: "serif" })).toEqual({
      ...DEFAULT_LOOK,
      colors: { ...DEFAULT_LOOK.colors, accent: "#e63946" },
      font: "serif",
    });
  });
});

describe("checkLook", () => {
  test("passes a readable Look", () => {
    expect(problems({ colors: { background: "#14213d", surface: "#22335c", text: "#f5f5f5", accent: "#fca311" } })).toEqual([]);
  });

  test("refuses text that can't be read on the background", () => {
    expect(problems({ colors: { background: "#888888", surface: "#000000", text: "#777777", accent: "#000000" } })).toEqual([
      "look.colors: text #777777 on background #888888 has a contrast of 1.26 to 1; text on background needs at least 4.5 to 1. Make one of them lighter or darker",
    ]);
  });

  test("refuses text that can't be read on the surface", () => {
    expect(problems({ colors: { background: "#000000", surface: "#eeeeee", text: "#ffffff", accent: "#ffcc00" } })).toEqual([
      "look.colors: text #ffffff on surface #eeeeee has a contrast of 1.16 to 1; text on surface needs at least 4.5 to 1. Make one of them lighter or darker",
    ]);
  });

  test("refuses an accent that can't be seen on the background", () => {
    expect(problems({ colors: { background: "#ffffff", surface: "#ffffff", text: "#000000", accent: "#ffd700" } })).toEqual([
      "look.colors: accent #ffd700 on background #ffffff has a contrast of 1.40 to 1; accent on background needs at least 3 to 1. Make one of them lighter or darker",
    ]);
  });

  test("measures a partial Look after the defaults fill it, and says which colours were defaults", () => {
    // Only a dark background: fine alone, unreadable with the default dark text and blue accent on it.
    expect(problems({ colors: { background: "#111111" } })).toEqual([
      "look.colors: text #1c1c1e (the site's default: the look sets no text colour) on background #111111 has a contrast of 1.10 to 1; text on background needs at least 4.5 to 1. Make one of them lighter or darker",
      "look.colors: accent #2b59c3 (the site's default: the look sets no accent colour) on background #111111 has a contrast of 2.98 to 1; accent on background needs at least 3 to 1. Make one of them lighter or darker",
    ]);
    // Setting light text fixes the background but now fails on the default white surface.
    expect(problems({ colors: { background: "#111111", text: "#f5f5f5", accent: "#fca311" } })).toEqual([
      "look.colors: text #f5f5f5 on surface #ffffff (the site's default: the look sets no surface colour) has a contrast of 1.09 to 1; text on surface needs at least 4.5 to 1. Make one of them lighter or darker",
    ]);
  });

  test("reads three-digit hex colours", () => {
    expect(problems({ colors: { background: "#000", surface: "#222", text: "#fff", accent: "#fc0" } })).toEqual([]);
    expect(problems({ colors: { background: "#888", surface: "#000", text: "#777", accent: "#000" } })).toEqual([
      "look.colors: text #777 on background #888 has a contrast of 1.26 to 1; text on background needs at least 4.5 to 1. Make one of them lighter or darker",
    ]);
  });

  test("shows a ratio rounded down, so a failing one never reads as the one needed", () => {
    // #777777 on white is 4.478...: shown as 4.47, not 4.48 or 4.50.
    expect(problems({ colors: { background: "#ffffff", surface: "#ffffff", text: "#777777", accent: "#000000" } })[0]).toContain("a contrast of 4.47 to 1");
  });

  test("measures nothing until every colour is a real colour", () => {
    expect(problems({ colors: { background: "black", text: "#000" } })).toEqual(['look.colors.background: must be a colour written "#rgb" or "#rrggbb"']);
  });
});

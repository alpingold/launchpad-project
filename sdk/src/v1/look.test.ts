// A Look must be readable once the site's defaults fill its gaps: text on the background and on the
// surface at 4.5 to 1 or more, the accent on the background at 3 to 1 or more (WCAG 2 contrast).
import { describe, expect, test } from "vitest";
import { checkLook, contrastRatio, DARK_LOOK, defaultsFor, LIGHT_LOOK, MIN_ACCENT_CONTRAST, MIN_TEXT_CONTRAST, withDefaults } from "./check.js";
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

describe("the site's default Looks", () => {
  test.each([
    ["light", LIGHT_LOOK],
    ["dark", DARK_LOOK],
  ] as const)("the %s one passes the rules it is used to fill in", (_name, look) => {
    expect(checkLook(look)).toEqual({ ok: true, look });
    const { background, surface, text, accent } = look.colors;
    expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(accent, background)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
  });

  test("the light one fills the gaps when the Game sets no background or a light one; the dark one for a dark background", () => {
    expect(defaultsFor(undefined)).toBe(LIGHT_LOOK);
    expect(defaultsFor("#fffbe6")).toBe(LIGHT_LOOK);
    expect(defaultsFor("#767676")).toBe(LIGHT_LOOK);
    expect(defaultsFor("#757575")).toBe(DARK_LOOK);
    expect(defaultsFor("#111")).toBe(DARK_LOOK);
    expect(defaultsFor("#14213d")).toBe(DARK_LOOK);
  });

  test("fills every gap in a Game's Look, and only the gaps", () => {
    expect(withDefaults(undefined)).toEqual(LIGHT_LOOK);
    expect(withDefaults({ colors: { accent: "#e63946", text: undefined }, font: "serif" })).toEqual({
      ...LIGHT_LOOK,
      colors: { ...LIGHT_LOOK.colors, accent: "#e63946" },
      font: "serif",
    });
    expect(withDefaults({ colors: { background: "#111111" } })).toEqual({ ...DARK_LOOK, colors: { ...DARK_LOOK.colors, background: "#111111" } });
  });

  test("a Look that sets only its background always has readable text, whatever the colour", () => {
    for (let r = 0; r < 256; r += 15) {
      for (let g = 0; g < 256; g += 15) {
        for (let b = 0; b < 256; b += 15) {
          const background = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}` as Hex;
          const colors = withDefaults({ colors: { background } }).colors;
          expect(contrastRatio(colors.text, background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
          expect(contrastRatio(colors.text, colors.surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        }
      }
    }
  });

  test("any single background colour passes on its own, across a wide sweep of colours", () => {
    // Every three-digit colour (16 steps per channel), every grey, and a finer six-digit grid.
    const backgrounds = new Set<Hex>();
    const hexOf = (r: number, g: number, b: number) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}` as Hex;
    for (let r = 0; r < 16; r++) for (let g = 0; g < 16; g++) for (let b = 0; b < 16; b++) backgrounds.add(`#${[r, g, b].map((c) => c.toString(16)).join("")}` as Hex);
    for (let v = 0; v < 256; v++) backgrounds.add(hexOf(v, v, v));
    for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) backgrounds.add(hexOf(r, g, b));
    const failing = [...backgrounds].filter((background) => !checkLook({ colors: { background } }).ok);
    expect(failing).toEqual([]);
    // checkLook doesn't measure the accent on the surface, but the site draws accents on cards too:
    // an accent the site fills in must show up there as well.
    const unseenOnCards = [...backgrounds].filter((background) => {
      const { surface, accent } = withDefaults({ colors: { background } }).colors;
      return contrastRatio(accent, surface) < MIN_ACCENT_CONTRAST;
    });
    expect(unseenOnCards).toEqual([]);
    expect(backgrounds.size).toBeGreaterThan(9_000);
  });

  test("the accent a Game leaves out is the default one where it shows up, else black or white", () => {
    const accentFor = (background: Hex) => withDefaults({ colors: { background } }).colors.accent;
    expect(accentFor("#ffffff")).toBe(LIGHT_LOOK.colors.accent);
    expect(accentFor("#111111")).toBe(DARK_LOOK.colors.accent);
    // Light defaults (black text, white cards), and their blue is too dark here. The dark defaults'
    // yellow would show up on the background but not on the white cards, so it isn't borrowed.
    expect(accentFor("#767676")).toBe("#000000");
    // The default accent doesn't reach 3 to 1 on these: the accent is the default text colour.
    expect(accentFor("#e63946")).toBe("#000000");
    expect(accentFor("#3a86ff")).toBe("#000000");
    expect(accentFor("#2a9d8f")).toBe("#000000");
    expect(accentFor("#808080")).toBe("#000000");
  });

  test("never changes an accent the Game sets, even one that can't be seen", () => {
    expect(withDefaults({ colors: { background: "#e63946", accent: "#ff0000" } }).colors.accent).toBe("#ff0000");
    expect(problems({ colors: { background: "#e63946", accent: "#ff0000" } })).toEqual([
      "look.colors: accent #ff0000 on background #e63946 has a contrast of 1.04 to 1; accent on background needs at least 3 to 1. Make one of them lighter or darker",
    ]);
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

  test("a Look of only a dark background passes: the dark defaults fill the rest", () => {
    expect(problems({ colors: { background: "#111111" } })).toEqual([]);
  });

  test("measures a partial Look after the defaults fill it, and says which colours were defaults", () => {
    // Only a dark surface: no background, so the light defaults fill in, and their black text can't be read on it.
    expect(problems({ colors: { surface: "#111111" } })).toEqual([
      "look.colors: text #000000 (the site's light default: the look sets no text colour) on surface #111111 has a contrast of 1.11 to 1; text on surface needs at least 4.5 to 1. Make one of them lighter or darker",
    ]);
    // A dark background brings the dark defaults' white text, which a light surface then can't carry.
    expect(problems({ colors: { background: "#111111", surface: "#eeeeee" } })).toEqual([
      "look.colors: text #ffffff (the site's dark default: the look sets no text colour) on surface #eeeeee has a contrast of 1.16 to 1; text on surface needs at least 4.5 to 1. Make one of them lighter or darker",
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

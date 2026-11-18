/**
 * A Game's Look as CSS: the filled-in colours, typeface and corners become CSS variables on a View's
 * root, and every Part draws with those. The Look is filled in by the SDK's own `withDefaults`, the
 * same function the checker used, so a View is drawn with exactly the colours it was checked with.
 */
import type { Color, Look } from "@boilergames/sdk/v1";
import { contrastRatio, withDefaults } from "@boilergames/sdk/v1/check";
import type { CSSProperties } from "react";

/**
 * The site's own typefaces (fonts.css), each followed by its metric-matched fallback, so text shows
 * at once and barely moves when the font arrives. Games can't load fonts: they have no network.
 */
const FONTS = {
  plain: '"Atkinson Hyperlegible", "Atkinson Hyperlegible Fallback", system-ui, sans-serif',
  rounded: '"Nunito", "Nunito Fallback", system-ui, sans-serif',
  serif: '"Source Serif 4", "Source Serif 4 Fallback", Georgia, serif',
  mono: '"JetBrains Mono", "JetBrains Mono Fallback", ui-monospace, monospace',
  poster: '"Anton", "Anton Fallback", Impact, sans-serif',
  handwritten: '"Patrick Hand", "Patrick Hand Fallback", cursive',
} as const;

/** The typefaces with one weight: a browser would fake their bold, badly, so it mustn't. */
export const SINGLE_WEIGHT_FONTS: ReadonlySet<string> = new Set(["poster", "handwritten"]);

/** The Look's typeface name, filled in: what the View's root records for the CSS. */
export function lookFont(look: Look | undefined): string {
  return withDefaults(look).font;
}

const CORNERS = { sharp: "0px", soft: "10px", round: "22px" } as const;

/** Black or white, whichever reads better on `background`: always at least 4.58 to 1, so a button is always readable. */
export function readableOn(background: `#${string}`): "#000000" | "#ffffff" {
  return contrastRatio("#000000", background) >= contrastRatio("#ffffff", background) ? "#000000" : "#ffffff";
}

/** The CSS variables a View's root carries. */
export function lookStyle(look: Look | undefined): CSSProperties {
  const full = withDefaults(look);
  const { background, surface, text, accent } = full.colors;
  return {
    "--kit-background": background,
    "--kit-surface": surface,
    "--kit-text": text,
    "--kit-accent": accent,
    "--kit-on-accent": readableOn(accent),
    "--kit-font": FONTS[full.font],
    "--kit-radius": CORNERS[full.corners],
  } as CSSProperties;
}

/** A picture's colour: a hex as it is, or one of the Look's colours by name. */
export function cssColor(color: Color | undefined): string | undefined {
  if (color === undefined) return undefined;
  return color.startsWith("#") ? color : `var(--kit-${color})`;
}

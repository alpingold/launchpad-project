/**
 * A Game's Look as CSS: the filled-in colours, typeface and corners become CSS variables on a View's
 * root, and every Part draws with those. The Look is filled in by the SDK's own `withDefaults`, the
 * same function the checker used, so a View is drawn with exactly the colours it was checked with.
 */
import type { Color, Look } from "@boilergames/sdk/v1";
import { contrastRatio, withDefaults } from "@boilergames/sdk/v1/check";
import type { CSSProperties } from "react";

/** The site's own typefaces. Games can't load fonts (they have no network), so these are system stacks. */
const FONTS = {
  plain: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  poster: 'Impact, "Arial Black", "Helvetica Neue", system-ui, sans-serif',
  handwritten: '"Comic Sans MS", "Segoe Print", "Bradley Hand", cursive',
} as const;

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

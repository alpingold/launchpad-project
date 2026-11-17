/**
 * The site's own Look, how a Game's Look is filled in from it, and how readable two colours are.
 *
 * One place for both the checker (which refuses an unreadable Look) and the Kit renderer (which
 * draws with the filled-in Look), so the colours a Game was checked with are the colours it is
 * drawn with.
 */
import type { Hex, Look } from "./kit.js";

/** A Look with nothing left out: what a View is actually drawn with. */
export interface FullLook {
  readonly colors: { readonly [K in keyof NonNullable<Look["colors"]>]-?: Hex };
  readonly font: NonNullable<Look["font"]>;
  readonly corners: NonNullable<Look["corners"]>;
}

/**
 * What the site uses for anything a Game's Look leaves out. Plain on purpose: the site's own design
 * comes later. These colours pass the readability rules below, with room to spare (a test checks).
 */
export const DEFAULT_LOOK: FullLook = {
  colors: {
    background: "#f4f4f1",
    surface: "#ffffff",
    text: "#1c1c1e",
    accent: "#2b59c3",
  },
  font: "plain",
  corners: "soft",
};

/** The Game's Look with every gap filled from {@link DEFAULT_LOOK}. A field set to `undefined` is a gap. */
export function withDefaults(look: Look | undefined): FullLook {
  const colors = look?.colors;
  return {
    colors: {
      background: colors?.background ?? DEFAULT_LOOK.colors.background,
      surface: colors?.surface ?? DEFAULT_LOOK.colors.surface,
      text: colors?.text ?? DEFAULT_LOOK.colors.text,
      accent: colors?.accent ?? DEFAULT_LOOK.colors.accent,
    },
    font: look?.font ?? DEFAULT_LOOK.font,
    corners: look?.corners ?? DEFAULT_LOOK.corners,
  };
}

// ---------------------------------------------------------------------------------------------
// Readability, measured as the WCAG 2 contrast ratio: from 1 to 1 (the same colour twice) up to
// 21 to 1 (black on white). It compares how bright two colours look to a human eye.

/** Text on the background, and text on the surface (cards, tiles, text boxes). WCAG's level AA for text. */
export const MIN_TEXT_CONTRAST = 4.5;
/** The accent on the background: the timer and highlights are drawn in it. WCAG's level for graphics and large text. */
export const MIN_ACCENT_CONTRAST = 3;

/** The pairs every Look must keep readable, after its gaps are filled with the site's defaults. */
export const READABLE_PAIRS = [
  { front: "text", back: "background", min: MIN_TEXT_CONTRAST },
  { front: "text", back: "surface", min: MIN_TEXT_CONTRAST },
  { front: "accent", back: "background", min: MIN_ACCENT_CONTRAST },
] as const satisfies readonly { front: keyof FullLook["colors"]; back: keyof FullLook["colors"]; min: number }[];

/** The contrast ratio of two colours written "#rgb" or "#rrggbb": a number from 1 to 21. */
export function contrastRatio(a: Hex, b: Hex): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** How bright a colour looks, from 0 (black) to 1 (white). */
function luminance(color: Hex): number {
  const digits = color.slice(1);
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
  const [r, g, b] = [0, 2, 4].map((i) => linear(parseInt(full.slice(i, i + 2), 16) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Undoes the curve sRGB stores colours with, so the channels can be added up as light. */
function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

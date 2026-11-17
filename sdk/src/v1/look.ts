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
 * What the site uses for anything a Game's Look leaves out, when the Game's background is light or
 * not set. Plain on purpose: the site's own design comes later. Both default Looks pass the
 * readability rules below, with room to spare (a test checks).
 */
export const LIGHT_LOOK: FullLook = {
  colors: { background: "#f4f4f1", surface: "#ffffff", text: "#000000", accent: "#1d3f91" },
  font: "plain",
  corners: "soft",
};

/** The same, for a Game that sets a dark background: light text, a dark surface, a bright accent. */
export const DARK_LOOK: FullLook = {
  colors: { background: "#141418", surface: "#222229", text: "#ffffff", accent: "#ffd166" },
  font: "plain",
  corners: "soft",
};

/**
 * Which default Look fills the gaps around a Game's background: the one whose text reads better on
 * it (light when the Game sets no background). In effect a switch on how bright the background is:
 * greys up to #757575 get the dark defaults.
 *
 * The default text colours are pure black and pure white on purpose. Whichever reads better on a
 * colour always reaches at least 4.58 to 1, so a Look that sets only its background always has
 * readable text. The accent is filled in separately, by {@link defaultAccent}.
 */
export function defaultsFor(background: Hex | undefined): FullLook {
  if (background === undefined) return LIGHT_LOOK;
  return contrastRatio(background, DARK_LOOK.colors.text) > contrastRatio(background, LIGHT_LOOK.colors.text) ? DARK_LOOK : LIGHT_LOOK;
}

/** The Game's Look with every gap filled from {@link defaultsFor} its background. A field set to `undefined` is a gap. */
export function withDefaults(look: Look | undefined): FullLook {
  const colors = look?.colors;
  const defaults = defaultsFor(colors?.background);
  return {
    colors: {
      background: colors?.background ?? defaults.colors.background,
      surface: colors?.surface ?? defaults.colors.surface,
      text: colors?.text ?? defaults.colors.text,
      accent: colors?.accent ?? defaultAccent(colors?.background ?? defaults.colors.background, defaults),
    },
    font: look?.font ?? defaults.font,
    corners: look?.corners ?? defaults.corners,
  };
}

/**
 * The accent for a Game that sets none: the default accent for its background if it can be seen
 * there, or else the default text colour (black or white).
 *
 * The fallback is for mid-bright backgrounds (greys from #767676 to #8f8f8f, a strong red like
 * #e63946, a blue like #3a86ff, a teal like #2a9d8f), where the default accent doesn't reach 3 to 1.
 * A generated Game picks colours like those often, and its author shouldn't have to know contrast
 * rules to get a Look that passes. Black or white always reaches 4.58 to 1 there, the same reason
 * the default text does.
 *
 * It never borrows the other default's accent. That accent was chosen for the other default's
 * surface: the dark defaults' yellow on the light defaults' white cards is 1.4 to 1. Black or white
 * is the text colour of the same defaults, so it is readable on their surface too.
 */
function defaultAccent(background: Hex, defaults: FullLook): Hex {
  return contrastRatio(defaults.colors.accent, background) >= MIN_ACCENT_CONTRAST ? defaults.colors.accent : defaults.colors.text;
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

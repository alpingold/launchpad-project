# The site's typefaces

One per Look font name. Each is served from the site's own origin; a page downloads only the one
its Game's Look uses (the browser fetches a font only when text uses it). Copied from the Fontsource
packages on npm, which repackage the Google Fonts releases with their licence; no package is a
dependency. Latin subset, woff2.

| Look font   | Typeface              | Files                                                    | Source (npm, exact version)          | Licence     |
| ----------- | --------------------- | -------------------------------------------------------- | ------------------------------------ | ----------- |
| plain       | Atkinson Hyperlegible | atkinson-hyperlegible-400.woff2, -700.woff2               | @fontsource/atkinson-hyperlegible 5.3.0 | SIL OFL 1.1, LICENSE-atkinson-hyperlegible.txt |
| rounded     | Nunito                | nunito-400.woff2, -700.woff2                              | @fontsource/nunito 5.3.0              | SIL OFL 1.1, LICENSE-nunito.txt |
| serif       | Source Serif 4        | source-serif-4-400.woff2, -700.woff2                      | @fontsource/source-serif-4 5.3.1      | SIL OFL 1.1, LICENSE-source-serif-4.txt |
| mono        | JetBrains Mono        | jetbrains-mono-400.woff2, -700.woff2                      | @fontsource/jetbrains-mono 5.3.0      | SIL OFL 1.1, LICENSE-jetbrains-mono.txt |
| poster      | Anton                 | anton-400.woff2 (one weight)                              | @fontsource/anton 5.3.0               | SIL OFL 1.1, LICENSE-anton.txt |
| handwritten | Patrick Hand          | patrick-hand-400.woff2 (one weight)                       | @fontsource/patrick-hand 5.3.0        | SIL OFL 1.1, LICENSE-patrick-hand.txt |

Each file came from `https://cdn.jsdelivr.net/npm/@fontsource/<name>@<version>/files/<name>-latin-<weight>-normal.woff2`
and each licence from `https://cdn.jsdelivr.net/npm/@fontsource/<name>@<version>/LICENSE`, on 2026-11-17.
## Fallbacks

Until a font arrives, text shows in a system font resized to match it (client/src/kit/fonts.css), so
nothing moves much when the font swaps in. Each typeface has two fallback faces, and a device uses
the first whose system font it has:

| Fallback face  | System fonts it tries, in order                                  | Who has them                                   |
| -------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| Roboto         | Roboto                                                           | Android                                        |
| Arial          | Arial, Liberation Sans, Arimo, Helvetica                         | Windows, macOS, iOS; Linux (Liberation, Arimo) |
| Noto Serif     | Noto Serif                                                       | Android                                        |
| Times          | Times New Roman, Liberation Serif, Tinos                         | Windows, macOS, iOS; Linux (Liberation, Tinos) |
| Droid Sans Mono | Droid Sans Mono                                                  | Android                                        |
| Courier        | Courier New, Liberation Mono, Cousine                            | Windows, macOS, iOS; Linux (Liberation, Cousine) |

Source Serif 4 uses Noto Serif and Times, JetBrains Mono uses Droid Sans Mono and Courier, and the
four others use Roboto and Arial. Liberation Sans, Serif and Mono, and Arimo, Tinos and Cousine, are
made to have exactly the widths of Arial, Times New Roman and Courier New.

Which numbers were measured, and which are estimates. Measured means: in Chromium, on 2026-11-17,
the width of a sample sentence in the real font against the system font, and the real font's
ascent and descent.

- **Measured:** the Arial, Times and Courier faces, against Liberation Sans, Liberation Serif and
  Liberation Mono on Linux. They hold for Arial, Times New Roman and Courier New because those have
  the same widths. The Arial and Courier numbers were measured with the fonts themselves, the Times
  numbers through a `local()` face; the two ways differ by under half a percent.
- **Measured, against a copy:** the Roboto and Noto Serif faces, against Roboto and Noto Serif from
  Fontsource (`@fontsource/roboto` and `@fontsource/noto-serif` 5.3.0, used only for measuring and not
  kept). A phone's own copy may be a newer version, with slightly different widths.
- **Estimates:**
  - Helvetica, in the Arial face: it was given Arial's numbers, because Arial was drawn to Helvetica's
    widths. It matters only on an Apple device without Arial, and Apple devices ship Arial.
  - The Droid Sans Mono face: it was given the Courier numbers, because every character in Droid Sans
    Mono, JetBrains Mono and Courier New is 0.6 of the font size wide. No copy of Droid Sans Mono was
    at hand to measure.
  - That the names match at all on a real phone: a browser finds a system font by its full or
    PostScript name, and each face lists the names these fonts are known by. That was not checked on a
    real Android phone or iPhone.

The browser test that checks a swap doesn't move a button (e2e/site.spec.ts) runs on Linux, so it
exercises only the Arial face.

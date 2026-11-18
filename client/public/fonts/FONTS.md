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
The fallback metrics in client/src/kit/fonts.css were measured against Liberation Sans and Liberation
Mono (the same metrics as Arial and Courier New) in Chromium.

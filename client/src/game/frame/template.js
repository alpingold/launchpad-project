// Wraps a game file (a fragment of HTML, plan §13c) in the document its iframe shows.
// The first thing in it is the security policy, then the base style (base.css), the
// `party` SDK with its helpers (ui.js, sdk.js), then the game.
//
// The Content-Security-Policy (plan §13e) is a list of what this document may load:
//  - only its own inline scripts and styles (no scripts from anywhere else, and no eval:
//    'unsafe-eval' isn't listed)
//  - pictures and sounds only from our art library (or made by the game itself: data:, blob:)
//  - NOTHING else: default-src 'none' means no fetch, WebSockets, workers, frames or fonts
//    from outside. A game's only way out is postMessage to our page, which checks it.
//  - form-action and base-uri aren't covered by default-src, so they're listed too.
// The iframe's sandbox (GameFrame.jsx) adds the other half: no access to our page, cookies or
// storage, and no redirecting our page.
//
// Note for later: a srcdoc document also inherits OUR page's policy. If the site ever sends
// a strict CSP header (script-src 'self'), inline game scripts would be blocked; the game
// page would then need its own address.
//
// This file imports nothing, so Node can use it too: the game checker (generator/src/check)
// builds exactly the same document for its headless-browser playtest. The site's version,
// with the SDK files filled in by Vite, is frameDocument.js.

/** The policy for a game document; `origin` is our site's (e.g. https://boilergames.example). */
export function contentSecurityPolicy(origin) {
  const art = `${origin}/game-assets/`;
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `img-src data: blob: ${art}`,
    `media-src data: blob: ${art}`,
    'font-src data:',
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/**
 * @param {{ style: string, ui: string, sdk: string }} parts  base.css, ui.js and sdk.js, as text
 * @param {string} gameSource  the game file
 * @param {string} origin      our site's origin (window.location.origin)
 */
export function frameDocumentFrom({ style, ui, sdk }, gameSource, origin) {
  const csp = contentSecurityPolicy(origin).replaceAll('"', '&quot;');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${style}</style>
<script>${ui}</script>
<script>${sdk}</script>
</head>
<body>
${gameSource}
</body>
</html>`;
}

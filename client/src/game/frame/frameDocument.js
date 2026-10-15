import sdkSource from './sdk.js?raw';

// Wraps a game file (a fragment of HTML, plan §13c) in the document its iframe shows.
// The first thing in it is the security policy, then the `party` SDK, then the game.
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

// Plain defaults (the site's own colors) so a game that brings no styles still looks fine in
// both themes. F2 adds the full BoilerGames look and helpers inside frames.
const BASE_STYLE = `
  :root { color-scheme: light; --bg: #f5f5fa; --surface: #ffffff; --text: #1a1a2e; --muted: #6b6b80; --accent: #4a3aff; --on-accent: #ffffff; }
  :root[data-theme="dark"] { color-scheme: dark; --bg: #14141f; --surface: #1f1f2e; --text: #ececf5; --muted: #a3a3b8; --accent: #5b4dff; }
  html, body { margin: 0; height: 100%; }
  body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; }
`;

/**
 * @param {string} gameSource  the game file
 * @param {string} origin      our site's origin (window.location.origin)
 */
export function buildFrameDocument(gameSource, origin) {
  const csp = contentSecurityPolicy(origin).replaceAll('"', '&quot;');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${BASE_STYLE}</style>
<script>${sdkSource}</script>
</head>
<body>
${gameSource}
</body>
</html>`;
}

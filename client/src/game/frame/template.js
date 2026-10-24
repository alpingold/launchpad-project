// Wraps a game file (a fragment of HTML, plan §13c) in the document its iframe shows.
// The first thing in it is the security policy, then LOCKDOWN (below), the base style (base.css), the
// `party` SDK with its ready-made pieces (ui.js, sdk.js), then the game.
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
// Two ways out that neither covers (plan §59): WebRTC (the CSP has no rule for it, so a game
// could reach any STUN/TURN server, and learn every player's IP address that way), and a game
// loading another page into its own frame (GameFrame removes the frame, but only after that
// first request). LOCKDOWN, the first script, removes WebRTC and any frame the game adds (a
// child frame would get its own, untouched WebRTC). It's a speed bump, not a wall: anything a
// game is told can still leave by the second route, which is why the Privacy page says so.
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
 * Runs before anything else in the frame: deletes every WebRTC class (RTCPeerConnection and
 * friends), and removes any frame, object or embed the moment it's added to the page, before
 * its own scripts get to run. Games have no use for either (the static check refuses both).
 */
export const LOCKDOWN = `(function () {
  Object.getOwnPropertyNames(window).forEach(function (name) {
    if (/^(webkit)?RTC/.test(name)) try { delete window[name]; } catch (e) {}
  });
  var FRAMES = 'iframe, frame, object, embed';
  function sweep(node) {
    if (node.nodeType !== 1) return;
    if (node.matches(FRAMES)) return node.remove();
    node.querySelectorAll(FRAMES).forEach(function (frame) { frame.remove(); });
  }
  new MutationObserver(function (records) {
    records.forEach(function (record) { record.addedNodes.forEach(sweep); });
  }).observe(document, { childList: true, subtree: true });
})();`;

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
<script>${LOCKDOWN}</script>
<style>${style}</style>
<script>${ui}</script>
<script>${sdk}</script>
</head>
<body>
${gameSource}
</body>
</html>`;
}

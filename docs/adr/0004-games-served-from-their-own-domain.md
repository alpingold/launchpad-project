# The Game frame is served from its own domain

Decided 2026-10-30, revised 2026-11-16. The Game frame is served from boilergames-play.party, a
separate registrable domain, not from boilergames.party or a subdomain. Browsers treat a subdomain
as the same site, so cookies can reach it. A frame with no `allow-same-origin` already gets a null
origin, so the domain is a second wall: it still holds if someone adds `allow-same-origin` "to fix a
bug". Never add `allow-same-origin` to the Game frame.

That domain serves one small static page per SDK version, holding that version's frozen Engine. It
serves no Game: the Screen fetches a Game's bundle from the site and hands it to the frame as text,
and the frame starts it in a worker. So the game domain has no API, no database and nothing private.

## Which walls are the browser's, and which are ours

Added 2026-11-17, after the browser tests of step 4.

- **The network wall is the browser's: the frame's Content-Security-Policy header.** With the header
  removed, a Game's `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `importScripts` all
  reached outside servers, in Chromium and Firefox, even where the browser reported them as failed.
  So nothing in front of the frame server (a proxy, a CDN, a cache) may drop or rewrite that header.
- **The storage wall is partly our own code.** The frame's opaque origin makes the browsers refuse
  most storage: `indexedDB`, the origin private file system, locks, service workers, cookies. But
  WebKit gives a sandboxed worker a working cache store (`caches`), and in a saved profile every
  Game on the site shares it, across Matches and browser restarts. The browser tests found that
  only in a saved profile, so every browser test now runs in a fresh profile and a saved one.
- So, before each Game loads, the frame empties the cache store, in a worker of its own because
  WebKit refuses the store to the frame's page, and waits for that to finish. Then, before the
  Game's code runs, the worker's bootstrap removes these, from every object on the global's
  prototype chain where the browser defines them, and fixes each on the global as `undefined`
  (unwritable, unconfigurable), so there is nothing left to call or put back:
  - `caches`, `CacheStorage`, `Cache`: the store itself.
  - `Worker`: a worker the Game started itself would have a fresh global with `caches` back in it.
  - `BroadcastChannel`: it opens in all three browsers. In the tests it reached no other Game,
    because each sandboxed frame has its own origin; it is removed so that stays true if a browser
    ever keys it the way WebKit keys the cache store.
- The browser tests check this in Chromium, Firefox and WebKit: every route back to `caches` and
  `Worker` fails, and a Game finds nothing another Game tried to leave, whether they run side by
  side, one after the other, or with a browser restart between them.
- **Not tested: real Safari.** The tests use Playwright's WebKit on Linux. Step 9 checks Safari on
  an iPhone and a Mac with the owner.

// The three origins the browser tests use. Fixed ports, so the hostile bundle can name its targets.
// The site and the frame are on different hosts (localhost and 127.0.0.1), so they are different
// sites, as in production, where the game domain is its own registrable domain.

/** The site: serves the test Screen page and the bundles, and counts any request to /probe/. */
export const SITE = "http://localhost:4100";
/** The game domain: the real frame server, with the real header. */
export const FRAME = "http://127.0.0.1:4101";
/** An "outside address" the Game would like to send things to. Counts every request it gets. */
export const OUTSIDE = "http://127.0.0.1:4102";

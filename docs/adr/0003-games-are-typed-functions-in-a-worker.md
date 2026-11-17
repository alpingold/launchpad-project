# Games are typed functions in a worker; the site draws every view

Decided 2026-10-30, revised 2026-11-16. A Game is a TypeScript module of plain functions over plain
data. Its logic takes the state and returns the next state; its views are data made of Kit Parts.
In the Host's browser it runs in a Web Worker inside a hidden, sandboxed frame served from its own
domain (ADR 0004). The site draws every view with its own code, on the Screen and on phones alike,
so no device ever runs Game code outside that worker, and the frame has nothing to show. A worker
has no page to navigate, no WebRTC and no network, so "Games have no network access" holds with no
exceptions.

One Engine runs every Match: in the browser, in the Playtest and in tests. It calls the Game's
functions and checks everything they return. Typed pure functions let `tsc` and a simulator catch
the crashes and stuck games that the first site needed an AI reviewer for.

## Considered options

- **Games as free HTML/CSS pages in a sandboxed frame** (the first site): any look, but a one-way
  leak (self-navigation, WebRTC) that no browser setting closes, and much more code for the AI to
  get wrong.
- **Canvas on the Screen, drawn by the Game:** frame-by-frame freedom, but a draw function isn't
  data: the frame would have to be visible, and the Screen's view couldn't be checked, saved or
  replayed. Left for SDK v2, with real-time play.
- **An HTML-like view description, drawn through an allow-list:** most of the look back, but a
  large security-critical renderer. The Picture Part (ADR 0006) is the smaller version of this idea.
- **Running Games on the server:** makes reloads and cheating trivial to handle, but strangers'
  code would run on the one server during game nights (ADR 0005).

## Consequences

- A Game can only show what the Kit can draw. The Picture Part is the way out; the Kit grows when
  real Games show what's missing.
- State must be plain data, which the compiler enforces.
- No animation a Game controls frame by frame, and no real-time play, until SDK v2.

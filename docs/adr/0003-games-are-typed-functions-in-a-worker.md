# Games are typed functions in a worker; phones draw kit views

Decided 2026-10-30, taking the game model from the owner's serverless experiment
(`~/slopProjects/boilergamesretry`, its ADRs 0001, 0006 and 0008) but not its hosting. A Game is a
TypeScript module: its logic (`setup`, `update`) is pure functions that run in a Web Worker inside
a sandboxed frame served from its own domain (boilergames-play.party). Its views are data. Phones
draw them from a fixed kit and never run Game code. The Screen gets the kit, plus canvas and SVG
and per-Game theming (colours, fonts, component variants, all sent as data). A worker has no page
to navigate, no WebRTC and no network, so "Games have no network access" holds with no exceptions.
Typed pure functions also let `tsc` and a simulator catch the crashes and stuck games that the old
AI reviewer was there for.

## Considered options

- **Games as free HTML/CSS pages in a sandboxed frame** (2026-10-15 to 2026-10-30): any look, but
  a one-way leak (self-navigation, WebRTC) that no browser setting closes, and much more code for
  the AI to get wrong.
- **An HTML-like view description, drawn through an allow-list:** most of the look back, but we
  would own a security-critical renderer. Kept as the next step if the kit plus theming proves too
  narrow.
- **Block games and the kit (before 2026-10-15):** every Game looked the same, and every new
  interaction needed a hand-written block. The risk remains here, since phones draw only the kit.
  We widen the kit when real Games show what is missing.

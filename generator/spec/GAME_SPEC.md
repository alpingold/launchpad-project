# How a BoilerGames game works

BoilerGames is a party platform: a host puts a **big screen** (a TV or laptop) in front of
the room, and 1–12 players join on their **phones**. A game is **one HTML file**. The same
file runs on the big screen and on every phone, each inside a sandboxed iframe:

- **The big screen (role `"host"`) is the referee.** It holds the whole game: rules, timers,
  physics, scores, the world. It draws the big picture for the room, and tells each phone
  what to show.
- **Each phone (role `"player"`) is a controller.** It shows what the big screen tells it,
  and sends the player's input (taps, a joystick, a choice, a drawing) to the big screen.

The server only passes messages between them. Any kind of game works: party rounds, a
platformer, an RPG, a racing game, a puzzle, a drawing game. There are no required rounds,
phases or screens. A game must start, react to its players, and end with `party.end`.

## The file

```html
<script type="application/json" id="game-info">
  { "name": "Star Catch", "description": "Steer your dot and catch the stars. First to 5 wins.", "minPlayers": 1, "maxPlayers": 12 }
</script>
<style>
  /* the game's own styles */
</style>
<div id="app"></div>
<script>
  'use strict';
  party.ready(({ role, me, players, restored }) => (role === 'host' ? bigScreen(restored) : phone(me)));
  function bigScreen(restored) { /* ... */ }
  function phone(me) { /* ... */ }
</script>
```

- **It starts with the game-info block**, exactly as above: `name` (1–40 characters),
  `description` (at most 200), `minPlayers` (at least 1) and `maxPlayers` (at most 12). No
  other fields.
- It's a fragment that goes inside `<body>`: no `<html>`, `<head>` or `<body>` tags. The
  `party` SDK, its helpers and the base styles are already loaded before your code runs.
- **At most 300 KB.** Everything is in this one file: no other files exist.

## The rules (the checks enforce them)

1. **No network and no outside files.** No `fetch`, `XMLHttpRequest`, `WebSocket`,
   `import`, workers, `<script src>`, `<link>`, CDN libraries, Google Fonts, or pictures
   from web addresses. The browser blocks all of it. Use system fonts, draw with CSS,
   canvas or text characters, and `party.asset(id)` for the art library below.
2. **Never leave the page.** No links (`<a href>`), forms, `location`, `window.open` or meta
   refresh. Change what's on screen with the DOM instead. A game that loads another page
   is stopped.
3. **Only the `party` SDK talks to the outside.** No `postMessage`, `window.parent` or `top`.
4. **No storage, cookies or pop-ups.** `localStorage`, `sessionStorage`, `indexedDB`,
   `document.cookie`, `alert`, `confirm` and `prompt` don't work in a game. To survive a
   big-screen reload, use `party.save` (below).
5. **No code from text:** no `eval`, `new Function`, or `setTimeout` with a string. No
   `document.write`.
6. **Nothing waits forever.** Players leave, phones sleep, people don't press anything.
   Every wait for players has a timer, and a player who left is skipped.
7. **1 to 12 players** (within your `minPlayers`/`maxPlayers`) must all work: one player
   alone, and a full room.
8. **Never trust what a phone sends.** Check every event on the big screen: is it this
   player's turn, is the value one of the allowed ones, is the number in range.
9. **Text from players is text.** Use `party.ui.el` or `textContent`, never `innerHTML`,
   with names or anything a player typed.

## Design for the room

- **Phones:** portrait, one thumb, big tap targets (at least 48 px), the main controls at
  the bottom of the screen (`.screen` fills the phone; put a `.grow` spacer above the
  controls). Show the player who they are (name and colour) and what to do right now.
- **Big screen:** readable from across the room: big text, high contrast, few words. Show
  whose turn it is, timers, scores, and what just happened.
- **Both themes:** use the colour variables below, so the game looks right in light and dark
  mode. A canvas can read them with `getComputedStyle(document.documentElement)`.

## The `party` SDK

Start everything in `party.ready`; nothing else is available before it runs.

```js
party.ready(({ role, me, players, theme, restored }) => { ... })
//   role: 'host' (big screen) or 'player' (phone)
//   me: this phone's player id (null on the big screen)
//   players: [{ id, name, connected }], everyone in the game, fixed for the whole game
//   theme: 'light' or 'dark'
//   restored: on the big screen after a reload, the last party.save snapshot; else undefined
party.now()          // server time in ms: use it for every timer and deadline
party.asset(id)      // URL of an approved picture (see the art library), or null
party.players / party.me / party.role / party.theme   // the same, any time after ready
party.ui             // ready-made pieces (below)
party.on(name, fn)   // listen; the names are below
```

**On a phone:**

```js
party.send(data)                    // → the big screen's 'event'. Any small JSON value.
party.on('state', (state) => ...)   // what to show now; the LATEST state comes back after a phone reloads
party.on('message', (data) => ...)  // one-off messages ("you were hit!")
```

**On the big screen:**

```js
party.on('event', (playerId, data) => ...)   // a phone's party.send
party.setState(playerId | 'all', state)      // what a phone shows now; replaces its last state
party.sendTo(playerId, data) / party.sendAll(data)   // one-off messages
party.save(snapshot)                         // keep the game's state; see "Reloads"
party.on('left', (playerId) => ...)          // a phone disconnected (it may come back)
party.on('back', (playerId) => ...)          // it's back
party.end({ rankings: [playerId, ...], scores: { [playerId]: number } })   // the game is over
```

**Both:** `party.on('players', (players) => ...)` (who's connected changed) and
`party.on('theme', (theme) => ...)`.

**How to use it well:**

- **Every phone always has a state.** Call `party.setState` for every player as soon as the
  big screen starts, and whenever what that phone should show changes. Draw the phone only
  from its state: then a phone that reloads shows the right thing again by itself.
- **Send only when something changes.** The SDK groups the big screen's messages and sends
  them every 50 ms, so calling `setState` often is fine, but phones may send at most 20
  messages a second: send a joystick's direction when it changes, not every frame
  (`party.ui.joystick` already does this).
- **Size limits:** a phone's event at most 48 KB; each `setState`, `sendTo` or `party.save`
  from the big screen at most about 110 KB. Keep states small anyway: send each phone what it
  needs, not the whole game.
- **`party.end`:** `rankings` lists player ids best first (each at most once, only players
  in this game); `scores` is optional. Show a final screen on the big screen for a few
  seconds first, then call `party.end` (the platform then goes back to the lobby).

### Reloads

The big screen's page can reload in the middle of a game. Keep everything that matters in
one object, `party.save` it after every change that matters, and start from `restored`
when it's there:

```js
function bigScreen(restored) {
  let g = restored ?? { round: 1, scores: Object.fromEntries(party.players.map((p) => [p.id, 0])) };
  function changed() { /* draw, setState for every phone */ party.save(g); }
}
```

Timers don't survive a reload: store deadlines as `party.now()` times and set them again.

## `party.ui`: ready-made pieces

Use these instead of writing your own: they work on phones and keyboards, and look right
in both themes. Each takes an element or a CSS selector.

```js
const { el, joystick, gamepad, timer, scoreboard, drawPad, drawing, ascii, INK } = party.ui;

el(tag, props, ...children)
//   Builds an element. props: class, style (object), onClick etc. (handlers), other attributes.
//   Children are elements or text; text always stays text.
//   el('button', { class: 'big', onClick: () => party.send({ pick: 2 }) }, 'Two')

joystick(target, { onChange(x, y), color })
//   A thumb stick. x and y are -1..1 (y is down). Calls onChange only when it moved
//   (about 12 times a second at most) and once with (0, 0) on release. Arrow keys/WASD work too.
//   Returns { setColor(color), setEnabled(on), destroy() }.

gamepad(target, { dpad: 'horizontal' | 'full' | 'none', buttons: [{ id: 'jump', label: 'Jump', key: ' ' }], onChange(state, id) })
//   Buttons that count while held (several at once). state is every control's state,
//   e.g. { left: false, right: true, jump: false }. Returns { setEnabled(on), destroy() }.

timer(target, { endsAt, onDone })
//   A bar and seconds counting down to endsAt, a SERVER time (party.now() + ms).
//   Returns { set(newEndsAt), stop(), destroy() }.

scoreboard(target, { title, me })
//   .update([{ id, name, score, color }]): a table, best first; ties share a rank.

drawPad(target, { colors: ['black', 'red', 'blue'], onChange(strokes) })
//   A pad to draw on with a finger, with colour swatches, undo and clear.
//   Returns { strokes(), clear(), undo(), setEnabled(on), destroy() }.
//   Strokes are small JSON ([[color, [x, y, x, y, ...]], ...] on a 1000 × 750 sheet): send them with party.send.
drawing(target, strokes)        // shows strokes; returns { show(strokes) }
INK                             // the drawing colours: { black, red, blue, ... }

ascii(target, { cols, rows, colors: { '#': '#8d6e63', '$': 'gold' }, background })
//   A grid of text characters drawn on a canvas that fits its element (fast enough for 60 fps).
//   .render(lines, { cells: [{ x, y, ch: '@', color: 'red' }], colors })
//   lines: an array of strings (the map); cells: characters on top (players, monsters).
```

## Base styles

Already loaded; your own CSS always wins over them.

- **Colour variables:** `--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`,
  `--on-accent`, `--good`, `--bad`, `--gold`; also `--radius`, `--font`, `--mono`. They
  switch with the theme.
- **Classes:** `.screen` (fills the frame, a column with padding: use it as the phone's
  page), `.stack` (a column with gaps), `.row`, `.center`, `.grow` (takes the free space),
  `.card`, `.muted`, `.big-text`, `.good`, `.bad`, `.mono`. Buttons: `button` (accent
  colour), `button.secondary`, `button.big` (a large tap target).
- The big screen's page is scaled up automatically (`data-role="host"` on `<html>`).

# How a BoilerGames game works

BoilerGames is a party platform: a host puts a **big screen** (a TV or laptop) in front of
the room, and 1–12 players join on their **phones**. A game is **one HTML file**. The same
file runs on the big screen and on every phone, each inside a sandboxed iframe:

- **The big screen (role `"host"`) is the referee, in plain sight.** It holds the whole game:
  rules, timers, physics, scores, the world, and every player's secrets. It draws the big
  picture for the room, and tells each phone what to show. **Everyone in the room can see
  it**, so it only ever shows what everyone may know. ("host" is the shared screen, not a
  person running the game who may know everything.)
- **Each phone (role `"player"`) is a controller.** It shows what the big screen tells it,
  and sends the player's input (taps, a joystick, a choice, a drawing) to the big screen.

The server only passes messages between them. There are no required rounds, phases or
screens. A game must start, react to its players, and end with `party.end`.

**What plays well here.** Everyone looks at one big screen and holds a phone. A phone
reaches the big screen in about 0.05–0.15 s, its buttons can't be felt, and eyes are on the
TV, not the thumbs. So games work best when the phone is for **choices, secrets, words,
drawings or simple steering**, and the big screen for **the shared show**: party rounds,
voting and bluffing, drawing and guessing, trivia, board games, and loose, forgiving real-time
games (bumping, dodging, collecting). Avoid what needs pixel-precise timing on a touch
screen (precise platform jumping, rhythm games).

`async`/`await`, Promises, timers and `requestAnimationFrame` are all fine. (There's no
network, so there's nothing to fetch.)

## The file

```html
<script type="application/json" id="game-info">
  { "name": "Star Catch", "description": "Steer your dot and catch the stars. First to 5 wins.", "minPlayers": 1, "maxPlayers": 12,
    "tags": ["action"], "minutes": [1, 3] }
</script>
<style>
  /* the game's own styles */
</style>
<div id="app"></div>
<script>
  'use strict';
  party.ready(({ role, me, restored }) => (role === 'host' ? bigScreen(restored) : phone(me)));
  function bigScreen(restored) { /* ... party.players ... */ }
  function phone(me) { /* ... */ }
</script>
```

- **It starts with the game-info block**, exactly as above: `name` (1–40 characters),
  `description` (at most 200), `minPlayers` (at least 1), `maxPlayers` (at most 12), `tags`
  and `minutes`. No other fields. The game catalogue shows and filters by these.
  - `tags`: 1–4 of exactly these words: action, racing, platformer, adventure, rpg, board,
    strategy, puzzle, drawing, words, trivia, voting, bluffing, co-op, teams, minigame.
  - `minutes`: how long one whole game usually takes, low and high, in whole minutes:
    the total from the design's Length section (e.g. `[8, 12]`).
- It's a fragment that goes inside `<body>`: no `<html>`, `<head>` or `<body>` tags. The
  `party` SDK, its helpers and the base styles are already loaded before your code runs.
- **At most 100 KB.** Everything is in this one file: no other files exist.

## The rules (the checks enforce most of them; break none)

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
   `document.write`. **No password boxes** (`type="password"`): a game never asks for one.
6. **Nothing waits forever.** Players leave, phones sleep, people don't press anything.
   Every wait for players has a timer, and a player who left is skipped.
7. **1 to 12 players** (within your `minPlayers`/`maxPlayers`) must all work: one player
   alone, and a full room.
8. **Never trust what a phone sends.** Check every event on the big screen: is it this
   player's turn, is the value one of the allowed ones, is the number in range.
9. **Text from players is text.** Use `party.ui.el` or `textContent`, never `innerHTML`,
   with names or anything a player typed.
10. **Secrets stay on their own phone.** The big screen is a TV the whole room watches.
    Never show on it anything only some players may know (a role, a secret word, a hand of
    cards, an answer before its reveal): not as text, and not as a hint either, like a
    different colour or icon, the order of a list, or a caption such as "Ana is the spy".
    Send a secret only to its owner, with `party.setState(thatPlayer, …)` or
    `party.sendTo(thatPlayer, …)`, never to `'all'` or with `sendAll`. The big screen reveals
    a secret only on purpose, at the moment the design's Secrets section says. No sound on a
    phone that gives a secret away: the people next to it hear it.

## Design for the room

- **Phones:** portrait, one thumb, big tap targets (at least 48 px), the main controls at
  the bottom of the screen (`.screen` fills the phone; put a `.grow` spacer above the
  controls). Show the player who they are (name and colour) and what to do right now.
- **Big screen:** readable from across the room: big text, high contrast, few words. Show
  whose turn it is, timers, scores, and what just happened.
- **Length:** each round, level, race or fight takes at least about 20 seconds. Don't make a
  game longer with waiting.
- **Colours:** the game's own scene has its own colours. For page text, panels and buttons
  outside the scene, the colour variables below match the platform. A canvas can read them
  with `getComputedStyle(document.documentElement)`.

## The `party` SDK

Start everything in `party.ready`; nothing else is available before it runs.

```js
party.ready(({ role, me, players, restored }) => { ... })
//   role: 'host' (big screen) or 'player' (phone)
//   me: this phone's player id (null on the big screen)
//   players: [{ id, name, connected }], everyone in the game, fixed for the whole game
//   restored: on the big screen after a reload, the last party.save snapshot; else undefined
party.now()          // server time in ms: use it for every timer and deadline
party.asset(id)      // URL of an approved picture (see the art library), or null
party.players / party.me / party.role   // the same, any time after ready. In your own functions
//   write party.players: the `players` above exists only inside the party.ready callback.
party.ui             // ready-made pieces you can see (below)
party.on(name, fn)   // listen; the names are below
party.sound(name)    // a short sound made in code: 'tap', 'blip', 'tick', 'pop', 'coin', 'go', 'buzz', 'win', 'lose'
party.sound({ notes: [440, 660], ms: 120, type: 'square' })   // or your own (type: sine, square, triangle, sawtooth)
//   The big screen can play sounds any time; a phone after the player's first tap. Keep them
//   short and use them for moments (a point, a buzzer, the winner), not all the time.
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
party.setState(playerId | 'all', state)      // what a phone shows now; replaces its last state ('all': the same for every phone, so never a secret)
party.sendTo(playerId, data) / party.sendAll(data)   // one-off messages
party.save(snapshot)                         // keep the game's state; see "Reloads"
party.on('left', (playerId) => ...)          // a phone disconnected (it may come back)
party.on('back', (playerId) => ...)          // it's back
party.end({ rankings: [playerId, ...], scores: { [playerId]: number } })   // the game is over
```

**Both:** `party.on('players', (players) => ...)` (who's connected changed).

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
  in this game); `scores` is optional. A game with no winner calls `party.end({ rankings: [] })`. Show a final screen on the big screen for a few
  seconds first, then call `party.end` (the platform then goes back to the lobby).
- **Players are known by their `id`.** Keep each player's data in an object keyed by id
  (`scores[p.id]`), and compare ids with ids. A list's position (`0`, `1`, `2`) is never a
  player's id: comparing the two is always false, and the scores come out wrong.
- **Something that builds up over time** (a charge meter, a zone being held, a bar filling
  while a button is held) adds a little each frame and resets only when its cause stops. Work
  out the cause once per frame first ("is anyone still on the zone?"), then add or reset once:
  resetting it at the top of each frame, or in a loop where one thing's "no" undoes another's
  "yes", means it never fills.

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
Do this for **every** phase, the short ones too: a reload during the intro, a countdown or
the final screen must still move on (after the final screen, still call `party.end`). Save
which phase it is by name and pick what to do next from that name.
The snapshot travels as JSON: keep it to plain objects, arrays, strings, numbers and
booleans. A `Set`, `Map`, class instance or function comes back broken (a `Set` becomes `{}`,
a function is dropped), so never save a callback for what happens next.

## `party.ui`: ready-made pieces

The phone's input is the hard part on a touch screen; use these instead of writing your own
touch handling. They work on phones and keyboards. Each takes
an element or a CSS selector. Everything else (scores, boards, the scene) the game draws in
its own style.

```js
const { el, joystick, gamepad, textInput, timer, countdown, drawPad, drawing, INK } = party.ui;

el(tag, props, ...children)
//   Builds an element. props: class, style (object), onClick etc. (handlers), other attributes.
//   style keys are JavaScript names: { flexDirection: 'column' }, never { flex-direction: … }.
//   Children are elements or text; text always stays text.
//   el('button', { class: 'big', onClick: () => party.send({ pick: 2 }) }, 'Two')

joystick(target, { onChange(x, y), color })
//   A thumb stick. x and y are -1..1 (y is down). It starts where the thumb lands, with a small
//   dead zone. Calls onChange only when it moved (about 12 times a second at most) and once
//   with (0, 0) on release. Arrow keys/WASD work too.
//   Returns { setColor(color), setEnabled(on), destroy() }.

gamepad(target, { dpad: 'horizontal' | 'full' | 'none', buttons: [{ id: 'jump', label: 'Jump', key: ' ' }], onChange(state, id) })
//   Buttons that count while held (several at once; a thumb can slide from ◀ to ▶). state is
//   every control's state, e.g. { left: false, right: true, jump: false }.
//   Returns { setEnabled(on), destroy() }.

textInput(target, { placeholder, maxLength: 80, button: 'Send', multiline: false, lockOnSubmit: false, onSubmit(text) })
//   A box for typing on a phone: Enter or Send calls onSubmit with the trimmed text (empty is
//   ignored) and empties the box. Big enough text that phones don't zoom in.
//   lockOnSubmit: true instead keeps the text and locks the box ("Sent ✓") until your next
//   screen replaces it. Use it whenever the NEXT thing to type comes in a new state (prompt 1
//   of 2, then 2 of 2): on a slow phone that state takes a moment, and an answer typed into the
//   old box meanwhile would be lost.
//   Returns { value, clear(), focus(), setEnabled(on), destroy() }. Send the text with party.send.

timer(target, { endsAt, onDone })
//   A bar and seconds counting down to endsAt, a SERVER time (party.now() + ms).
//   Returns { set(newEndsAt), stop(), destroy() }.

drawPad(target, { colors: ['black', 'red', 'blue'], onChange(strokes) })
//   A pad to draw on with a finger, with colour swatches, undo and clear.
//   Returns { strokes(), clear(), undo(), setEnabled(on), destroy() }.
//   Strokes are small JSON ([[color, [x, y, x, y, ...]], ...] on a 1000 × 750 sheet): send them with party.send.
drawing(target, strokes)        // shows strokes; returns { show(strokes) }
INK                             // the drawing colours: { black, red, blue, ... }

countdown(target, { endsAt, onGo })
//   A big 3, 2, 1, GO! over the screen, to endsAt (server time); onGo runs at zero.
```

## How to draw

Draw with shapes on a `<canvas>`, or with HTML and CSS for cards, lists and buttons. **Give
the game its own look**, the one in the design's Art section (its palette, background and
style), so it doesn't look like every other game. Whatever the style:

- **Readable from across the room:** big, high-contrast shapes and few words. Each player is
  easy to tell apart (their own colour, their name where it matters).
- **Fill the screen:** the big screen is a TV. Use the whole frame for the game, not a strip
  in the middle of an empty page.
- **Motion over detail:** easing, a pop, a shake or a flash when something happens says more
  than fine detail nobody can see from the couch.
- **A canvas that fits its box** (phone or TV, sharp on any screen): size it to its box times
  `devicePixelRatio`, scale the drawing context to match, draw in CSS pixels, and redraw when
  its size changes (`new ResizeObserver(draw).observe(canvas)`) or every frame in a real-time
  game. Draw in your own world units and scale them to the box, so the game looks the same
  on every screen.
- **The art library** (`party.asset(id)`) has a few approved pictures; use them where they fit.

## Base styles

Already loaded; your own CSS always wins over them.

- **Colour variables:** `--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`,
  `--on-accent`, `--good`, `--bad`, `--gold`; also `--radius`, `--font`, `--mono`.
- **Classes:** `.screen` (fills the frame, a column with padding: use it as the phone's
  page), `.stack` (a column with gaps), `.row`, `.center`, `.grow` (takes the free space),
  `.card`, `.muted`, `.big-text`, `.good`, `.bad`, `.mono`. Buttons: `button` (accent
  colour), `button.secondary`, `button.big` (a large tap target).
- The big screen's page is scaled up automatically (`data-role="host"` on `<html>`).

# How to write a BoilerGames game

BoilerGames is a party game platform, like Jackbox. A **host screen** (a laptop on a TV)
shows what everyone sees, and 1–12 **players** play on their phones. The server runs the
game; phones and the host screen only show what the game sends, and phones send back what
players do (taps, text, drawings, reaction times).

You write ONE JavaScript ES module. It has no imports and `export default`s a
**GameModule** object. The platform tests your game automatically with simulated
players before a human reviews it.

## The GameModule

```js
export default {
  contractVersion: 3,                 // always 3
  id: 'my-game',                      // lowercase letters, digits, dashes (the platform replaces it)
  name: 'My Game',                    // 1–40 characters
  description: 'One or two sentences for the game picker.', // at most 200 characters
  minPlayers: 2,                      // integer, at least 1
  maxPlayers: 12,                     // integer, at most 12
  createGame(ctx, options) {          // called once when the host presses Start
    // set up state, send the first screens, return the GameInstance
    return { onAction(playerId, action, input) { /* ... */ } };
  },
};
```

`options` is an object from the host, usually `{}`. Read it defensively, with defaults.

## `ctx`: everything the game can use

| Member | What it does |
|---|---|
| `ctx.players` | `[{ id, name }]`, everyone in the game, fixed at the start. Players who disconnect stay in the list. |
| `ctx.broadcast(screen)` | Shows `screen` on the host screen AND every phone. |
| `ctx.sendToPlayer(playerId, screen)` | Shows `screen` on one phone. |
| `ctx.sendToHost(screen)` | Shows `screen` on the host screen only. |
| `ctx.setTimeout(fn, ms)` | Runs `fn` after `ms` (0 to 600000). Returns a timer id (a number). All timers are cancelled when the game ends. |
| `ctx.clearTimeout(id)` | Cancels a timer. |
| `ctx.random()` | A number in [0, 1). Use it for ALL randomness (shuffles, dice, delays). |
| `ctx.now()` | Server time in milliseconds. Use it for timers: `endsAt: ctx.now() + 20000`. |
| `ctx.endGame({ rankings, scores })` | Ends the game. `rankings`: player ids, best first. `scores` (optional): `{ playerId: number }`; equal top scores are shown as a tie. Call it exactly once. |
| `ctx.log(text)` | A debug line on the server. |

## The GameInstance (what `createGame` returns)

| Member | When it's called |
|---|---|
| `onAction(playerId, action, input)` | **Required.** A player used a control: tapped a button or choice option, or submitted an input block. `action` is the object you put on it. `input` is the submitted value for input blocks (see each block's "Sends"), already checked by the platform; buttons and choices send none. |
| `onPlayerDisconnect(playerId)` | Optional. The player's phone dropped. They may come back, or not. Stop waiting for them. |
| `onPlayerReconnect(playerId)` | Optional. They're back. Use it only to update your state (e.g. "not away anymore"): the platform puts their latest screen back on their phone by itself. |
| `onHostReconnect()` | Optional. The platform resends the host screen's latest screen by itself. |
| `dispose()` | Optional. Rarely needed. |

## Screens

Everything a phone or the host screen shows is a **screen**: a list of blocks, like
`{ blocks: [{ type: 'text', text: 'Round 1', size: 'big' }, { type: 'button', label: 'Go!', action: { go: true } }] }`.
Each screen **replaces** what was shown before, so always send the complete current
screen. Every block and field you may use is listed in **the block reference** after these
instructions. `asset` fields take ids from the art library (listed at the end); use only
those ids. Player names never need to be typed into screens: use `playerName` and
`scoreboard` blocks with player ids, or `ctx.players` names in text.

## Make it a real party game

The kit is big on purpose. A good game uses it:

- **The big screen is the show.** Everyone watches it. Give it a headline, a `timer` bar
  while players think, a `progress` bar of who's done, and a reveal worth looking at: cards
  of answers, a gallery of drawings in a `grid`, everyone's times, a `scoreboard`.
- **Each phone gets the right control for the job:** `textInput` to write, `drawPad` to
  draw, `slider` to guess a number, `rank` to order things, `multiChoice` to pick several,
  `choice` to pick one, and the widgets (`reaction`, `mash`, `timingBar`, `tapTargets`)
  for anything fast. Never fake a fast game with buttons: a button tap is a round trip to
  the server, so the widgets measure speed on the phone, which is fair.
- **Phones can show different things.** Send each player their own screen: a secret word
  only the artist sees, a vote that leaves out your own answer, "You got it!" for the
  ones who did.
- **Follow the idea.** If the idea asks for drawing, typing, reflexes or tapping, use the
  block made for it. Pick a theme, name things, and write the on-screen text so it's fun to read.

## Players' input

- `onAction(playerId, action, input)`: `action` is the object you put on the block; `input`
  is what the player entered (see each block's "Sends"). The platform already checked it
  (text trimmed and within maxLength, numbers in range, drawings in the right format), so
  you only check it against the game: right phase, right round, not already answered.
- Compare typed text loosely: lowercase it and drop spaces and punctuation before
  comparing (see `normalize` in Sketch & Guess).
- An input block clears when that phone gets a new screen. Send a new screen after a wrong
  guess (with "Not X, try again!"), not while the player is still typing.

## The rules

1. **Use only `ctx`.** No `import`, `require`, `fetch`, `process`, `globalThis`, `eval`.
2. **Plain data only** in screens and actions: objects, arrays, strings, numbers, booleans.
3. **Every message is a screen** made of the blocks in the block reference.
4. **Randomness only from `ctx.random()`; time only from `ctx.now()` and `ctx.setTimeout()`.**
   Never `Math.random`, `Date`, or the global `setTimeout` / `setInterval`.
5. **Treat every action as untrusted.** The platform only delivers actions that are on
   that player's screen right now, but check them against your state anyway: right
   phase? right round? already answered? Ignore anything else.
6. **Call `ctx.endGame` exactly once**, when the game is over.
7. **Synchronous code only.** No `async`, `await`, or Promises. Use `ctx.setTimeout` to wait.

## Patterns that work (copy them)

The example games after the block reference show all of these. **Reaction Race** uses a
widget, **Sketch & Guess** drawing and typed guesses, **Fill the Blank** writing and voting.

- **State in a few variables** inside `createGame`, plus two functions that build what
  each screen should show *right now*: `hostView()` and `playerView(playerId)`. Whenever
  the state changes, send them out (`showEveryone()`).
- **Put the round number in every action** (`action: { answer: true, round }`) and ignore
  actions whose round isn't the current one. Stale taps happen.
- **Widgets:** set `goAt` / `startsAt` a few seconds in the future (`ctx.now() + 3000`), so
  every phone starts together. While a widget runs, don't send that phone a new screen (it
  would start over): update only the big screen. Then add your own `ctx.setTimeout` that
  ends the round even if some results never arrive.
- **Every wait for players needs a timeout.** People walk away, phones die, someone never
  answers. If the game waits for "everyone", also `ctx.setTimeout` a fallback that moves
  on, and don't wait for players who are disconnected. Show the wait with a `timer` bar.
- **Keep one pending timer** for "what happens next", and clear it before setting another
  (the `after(ms, fn)` helper in the examples).
- **Plan for 12 players.** A reveal with 12 answers must still fit in 60 blocks (keep each
  card to 2–3 blocks, put them in a `grid`), and a `choice` has at most 12 options.
- **A short game:** 2–5 minutes. A few rounds, a result screen of a few seconds after each,
  a final screen with a `scoreboard` block for about 6–8 seconds, then `ctx.endGame`.
- **Do little work per call.** No big loops. Each call must return in well under 100 ms.
- **One new screen per change.** When one player acts, update that player's phone and the
  big screen, not every phone.

## What the automatic tests check

Simulated players play your game many times (with minPlayers, 3 and maxPlayers players;
eager, slow, and absent players; phones that disconnect and come back; junk input). The
game fails if it: crashes; sends an invalid screen; uses an unknown asset; never ends or
gets stuck waiting; leaves a screen with nothing on it; is slow; floods phones with
screens; or breaks a rule above. If it fails, you get the list of problems and fix the
whole module.

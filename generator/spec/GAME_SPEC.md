# How to write a BoilerGames game

BoilerGames is a party game platform, like Jackbox. A **host screen** (a laptop on a TV)
shows what everyone sees, and 1–12 **players** play on their phones. The server runs the
game; phones and the host screen only display what the game sends and send back taps.

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
screen. Combine blocks freely: a round line, a question, a timer bar and a choice on one
phone; a headline, a progress bar per answer and a scoreboard on the host.

Every block and field you may use is listed in **the block reference** after these
instructions. `asset` fields take ids from the art library (listed at the end). Use only
those ids. Player names are never needed in screens: use `playerName` and `scoreboard`
blocks with player ids, or `ctx.players` names in text.

## The rules

1. **Use only `ctx`.** No `import`, `require`, `fetch`, `process`, `globalThis`, `eval`.
2. **Plain data only** in screens and actions: objects, arrays, strings, numbers, booleans.
3. **Every message is a screen** made of the blocks in the block reference.
4. **Randomness only from `ctx.random()`; time only from `ctx.now()` and `ctx.setTimeout()`.**
   Never `Math.random`, `Date`, or the global `setTimeout` / `setInterval`.
5. **Treat every action as untrusted.** The platform only delivers actions that are on
   that player's screen right now, but check them against your state anyway: right
   phase? right round? a value in range? already answered? Ignore anything else.
6. **Call `ctx.endGame` exactly once**, when the game is over.
7. **Synchronous code only.** No `async`, `await`, or Promises. Use `ctx.setTimeout` to wait.

## Patterns that work (copy them)

- **State in a few variables** inside `createGame`, plus two functions that build what
  each screen should show *right now*: `hostView()` and `playerView(playerId)`. Whenever
  the state changes, send them out (`showEveryone()`). See the example games.
- **Put the round number in every action** (`action: { answer: 2, round }`) and ignore
  actions whose round isn't the current one. Stale taps happen.
- **Every wait for players needs a timeout.** People walk away, phones die, someone never
  taps. If the game waits for "everyone to answer", also `ctx.setTimeout` a fallback that
  moves on, and don't wait for players who are disconnected.
- **Keep one pending timer** for "what happens next", and clear it before setting another
  (the `after(ms, fn)` helper in the examples).
- **A short game:** 2–5 minutes. A few rounds, a result screen of a few seconds after each,
  a final screen with a `scoreboard` block for about 6 seconds, then `ctx.endGame`.
- **Do little work per call.** No big loops. Each call must return in well under 100 ms.
- **Send each screen one new screen per change.** Not a screen per player per tap to everyone.

## What the automatic tests check

Simulated players play your game many times (1, 3 and 12 players; eager, slow, and
absent players; phones that disconnect and come back). The game fails if it:
crashes; sends an invalid screen; uses an unknown asset; never ends or gets stuck waiting;
leaves a screen with nothing on it; is slow; floods phones with screens; or breaks a rule
above. If it fails, you get the list of problems and fix the whole module.

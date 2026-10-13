# How to write a BoilerGames game

BoilerGames is a party game platform, like Jackbox. A **host screen** (a laptop on a TV)
shows the shared view, and 1–12 **players** play on their phones. The server runs the
game; phones and the host screen only display what the game sends and send back taps.

You write ONE JavaScript ES module. It has no imports and `export default`s a
**GameModule** object. The platform tests your game automatically with simulated
players before a human reviews it.

## The GameModule

```js
export default {
  contractVersion: 2,                 // always 2
  id: 'my-game',                      // lowercase letters, digits, dashes (the platform replaces it)
  name: 'My Game',                    // 1–40 characters
  description: 'One or two sentences for the game picker.', // at most 200 characters
  minPlayers: 2,                      // integer, at least 1
  maxPlayers: 12,                     // integer, at most 12
  createGame(ctx, options) {          // called once when the host presses Start
    // set up state, send the first views, return the GameInstance
    return { onAction(playerId, action) { /* ... */ } };
  },
};
```

`options` is an object from the host, usually `{}`. Read it defensively, with defaults.

## `ctx`: everything the game can use

| Member | What it does |
|---|---|
| `ctx.players` | `[{ id, name }]`, everyone in the game, fixed at the start. Players who disconnect stay in the list. |
| `ctx.broadcast(view)` | Shows `view` on the host screen AND every phone. |
| `ctx.sendToPlayer(playerId, view)` | Shows `view` on one phone. |
| `ctx.sendToHost(view)` | Shows `view` on the host screen only. |
| `ctx.setTimeout(fn, ms)` | Runs `fn` after `ms` (0 to 600000). Returns a timer id (a number). All timers are cancelled when the game ends. |
| `ctx.clearTimeout(id)` | Cancels a timer. |
| `ctx.random()` | A number in [0, 1). Use it for ALL randomness (shuffles, dice, delays). |
| `ctx.now()` | Server time in milliseconds. Use it for countdowns: `endsAt: ctx.now() + 20000`. |
| `ctx.endGame({ rankings, scores })` | Ends the game. `rankings`: player ids, best first. `scores` (optional): `{ playerId: number }`; equal top scores are shown as a tie. Call it exactly once. |
| `ctx.log(text)` | A debug line on the server. |

## The GameInstance (what `createGame` returns)

| Member | When it's called |
|---|---|
| `onAction(playerId, action)` | **Required.** A player tapped a button or a choice option. `action` is the object you put on that button. |
| `onPlayerDisconnect(playerId)` | Optional. The player's phone dropped. They may come back, or not. Stop waiting for them. |
| `onPlayerReconnect(playerId)` | Optional. They're back. Use it only to update your state (e.g. "not away anymore"): the platform puts their latest view back on their screen by itself. |
| `onHostReconnect()` | Optional. The platform resends the host screen's latest view by itself. |
| `dispose()` | Optional. Rarely needed. |

## Views: the ONLY things a screen can show

A view is a plain object. Each view **replaces** what that screen showed before, so
always send a screen its complete current view. Unknown fields are errors. Text is
shown as plain text, not HTML.

| `view` | Fields | Shown on |
|---|---|---|
| `message` | `title` (1–100 chars), `text?` (1–500 chars), `asset?` | host and phones |
| `button` | `label` (1–40 chars), `action` (an object), `asset?` | phones |
| `choice` | `prompt` (1–200 chars), `options`: 1–8 of `{ label (1–40 chars), action (an object), asset? }` | phones |
| `countdown` | `title` (1–100 chars), `endsAt` (server time in ms, from `ctx.now()`) | host and phones |
| `scoreboard` | `title` (1–100 chars), `rows`: at most 12 of `{ playerId, score (number) }`; names are filled in automatically | host and phones |

`asset` is the id of a picture from the art library (listed at the end of these
instructions). Use only those ids, or leave `asset` out.

A view must be at most 8 KB as JSON. Optional fields are left out, never `undefined` or `null`.

## The rules

1. **Use only `ctx`.** No `import`, `require`, `fetch`, `process`, `globalThis`, `eval`.
2. **Plain data only** in views and actions: objects, arrays, strings, numbers, booleans.
3. **Every message is a view** from the table above.
4. **Randomness only from `ctx.random()`; time only from `ctx.now()` and `ctx.setTimeout()`.**
   Never `Math.random`, `Date`, or the global `setTimeout` / `setInterval`.
5. **Treat every action as untrusted.** The platform only delivers actions that are on
   that player's screen right now, but check them against your state anyway: right
   phase? right round? a value in range? already answered? Ignore anything else.
6. **Call `ctx.endGame` exactly once**, when the game is over.
7. **Synchronous code only.** No `async`, `await`, or Promises. Use `ctx.setTimeout` to wait.

## Patterns that work (copy them)

- **State in a few variables** inside `createGame`, plus two functions that describe what
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
  a final `scoreboard` for about 6 seconds, then `ctx.endGame`.
- **Do little work per call.** No big loops. Each call must return in well under 100 ms.
- **Send each screen one view per change.** Not a view per player per tap to everyone.

## What the automatic tests check

Simulated players play your game many times (1, 3 and 12 players; eager, slow, and
absent players; phones that disconnect and come back). The game fails if it:
crashes; sends an invalid view; uses an unknown asset; never ends or gets stuck waiting;
leaves a screen with nothing on it; is slow; floods screens with views; or breaks a rule
above. If it fails, you get the list of problems and fix the whole module.

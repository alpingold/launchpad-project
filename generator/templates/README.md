# Starter templates for frame games

Small but complete games, each built around one common shape of game. In F5 (docs/PLAN.md
§13i) the generator starts from the one that fits the approved design; the parts to change
are marked `TEMPLATE`. Each one already handles the hard parts:
- **saving:** `party.save` after every change, picked up again from `restored`
- **phones that reload:** `party.setState` is sent again
- **players who leave:** the game stops waiting for them
- **timers:** so nothing waits forever

| File | Shape | Example game |
|---|---|---|
| `rounds.html` | Party rounds: everyone answers at once, reveal, scores, next round | Unique Number |
| `realtime.html` | Real-time: fixed steps and a canvas on the big screen, joysticks on phones | Star Catch |
| `turns.html` | Turn-based adventure: one player at a time, a board drawn with shapes, a turn timer | Treasure Hunt |

They're playable: the browser tests register them (`e2e/server/testServer.js`) and play
each one (`e2e/tests/templates.spec.js`). The full example game is in
`server/src/games/`: Bumper Blobs (real-time, drawn with canvas shapes).

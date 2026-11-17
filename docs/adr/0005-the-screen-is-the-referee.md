# The Screen is the referee; the server passes snapshots along

Decided 2026-11-16. The Game runs in the Host's browser, and the Screen decides every view. The
server keeps Rooms and Seats and passes messages between the Screen and the phones without reading
what a view or an Action holds. Every message that describes something is a whole snapshot: the
server sends the whole Room, and the Screen sends a phone's whole view. The Screen learns who joined
or left by comparing one Room with the next. The server keeps each Seat's latest view, so a phone
that wakes up gets it at once. The Screen saves the Match in its own browser storage after every
Step, and takes its Room back after a reload with a secret host token.

## Why

- Strangers' code never runs on the one server, and a Match costs it almost nothing.
- With snapshots, a lost message is repaired by the next one and a reconnect needs no special case.
  At 16 Players the snapshots are small.

## Considered options

- **Games on the server:** the server would be the one source of truth, but it would run untrusted
  code and carry every Match's load.
- **The server storing each Match's state:** a Match could move to another browser, but Game state
  would sit on the server and every Step would upload it.
- **Events instead of snapshots** ("player joined", "view changed by this much"): smaller messages,
  but every reconnect and every dropped message becomes a case to get right.

## Consequences

- A Match doesn't survive the Host's browser being lost. The Room and its Seats do.
- The Host could cheat by tampering with their own browser. For party games in one room, that's
  accepted.
- Actions sent while the Screen is away are dropped; the Player still sees their view and taps again.
- Phones must check every view before drawing it, since it comes from a Game by way of the Host.

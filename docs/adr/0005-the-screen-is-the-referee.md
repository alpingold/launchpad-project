# The Screen is the referee; the server passes snapshots along

Decided 2026-11-16. The Game runs in the Host's browser, and the Screen decides every View. The
server keeps Rooms and Seats and passes messages between the Screen and the phones without reading
what a View or an Action holds. Every message that describes something is a whole snapshot: the
server sends the whole Room, and the Screen sends a phone's whole View. The Screen learns who joined
or left by comparing one Room with the next. The server keeps each Seat's latest View, so a phone
that wakes up gets it at once. The Screen saves the Match in its own browser storage after every
Step, and takes its Room back after a reload with a secret host token.

## Why

- Strangers' code never runs on the one server, and a Match costs it almost nothing.
- With snapshots, a lost message is repaired by the next one, and a phone's reconnect needs no
  special case. At 16 Players the snapshots are small.
- The Screen's reconnect did need code (2026-11-17). The Screen is the one that sends: whatever it
  sent while its socket was down (a Match announced, Views, the end of a Match) never arrived, and
  the server can't ask for it again. So when its socket comes back during a Match, the Screen
  announces the Match again if the server lost it, sends every phone its latest View, and gives the
  Game frame the Room's Seats (some may have come or gone); and when no Match runs but the server
  still has one, it sends the end it lost (`client/src/screen/screen-room.ts`).

## Considered options

- **Games on the server:** the server would be the one source of truth, but it would run untrusted
  code and carry every Match's load.
- **The server storing each Match's state:** a Match could move to another browser, but Game state
  would sit on the server and every Step would upload it.
- **Events instead of snapshots** ("player joined", "view changed by this much"): smaller messages,
  but every reconnect and every dropped message becomes a case to get right.

## Consequences

- A Room and its Match survive the Screen reloading in the same browser, which keeps the host
  token and the saved Match. Without that browser's saved host token nothing can take the Room
  back: it closes 5 minutes after its Screen goes, or 60 seconds if it has no Seats, and the Match
  goes with it.
- Opening the Room in a second tab or on another device (with the host token) takes it over: the
  old page is told `closed: replaced` and must not reconnect, or the two would trade the Room
  forever. The same holds for a Seat taken up on a second phone.
- The Host could cheat by tampering with their own browser. For party games in one room, that's
  accepted.
- Actions sent while the Screen is away are dropped; the Player still sees their View and taps again.
- Phones must check every View before drawing it, since it comes from a Game by way of the Host.

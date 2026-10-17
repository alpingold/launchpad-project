# Comet Crew

## Genre and feel
A co-op action game: the whole room crews **one** little space tug on the TV, flying home
through a comet field. Every phone is a station on the ship: one steers, one shoots, one
holds the shield, one fights fires. Nobody can do it alone, so the room shouts: "Shields
top!", "Fire in the gun room!", "Grab that repair kit!". Everyone wins or loses together.

## Players
2–8 (`minPlayers` 2, `maxPlayers` 8). One player can't crash it (empty stations fly
themselves, badly).

**Stations**, filled in this order:

| # | Station | Phone control | Job |
|---|---|---|---|
| 1 | Helm | joystick | steer the ship: dodge rocks, fly into stars and repair kits |
| 2 | Gunner | joystick (aim) | the turret fires where the stick points; it overheats if you never let go |
| 3 | Shields | 4 big buttons ▲ ▼ ◀ ▶ | turn the shield to the side the next comet comes from |
| 4 | Engineer | 3 room tiles + Patch | tap a burning room to put it out; patch the hull when nothing burns |
| 5 | Navigator | warnings list + Tractor | sees each comet 5 s ahead (the TV: 2.6 s) and calls it out; once a wave, pulls every star and kit to the ship |
| 6 | Gunner 2 | joystick | a second turret, at the back |
| 7 | Engineer 2 | like Engineer | fires go out twice as fast |
| 8 | Gunner 3 | joystick | a third turret, underneath |

- **4–8 players:** stations 1..N are crewed. **2–3 players:** only the first four exist, and
  each wave a different 2 or 3 of them are crewed (wave 1: Helm + Gunner, wave 2: Gunner +
  Shields, ...); the rest are on **autopilot**.
- **Rotation:** after every wave, everyone moves one station along (seat order), so nobody
  is stuck on the quiet job and everyone learns every station.
- **Autopilot** (an empty station, or its player's phone disconnected): the helm drifts back
  to the middle and half-dodges, the turret shoots slowly with poor aim, the shield turns the
  right way only about half the time, the engineer works slowly. Good enough to keep 2
  players alive, clearly worse than a person.

## Big screen
- **The scene (canvas, fills the TV):** deep violet space with drifting star dots, the tug
  (cream hull, orange stripes, three rooms marked on its side: Engine, Guns, Shields), lumpy
  rocks drifting in from the front (and later from above and below), comets as white-cyan
  streaks, stars and green repair crosses to collect, the shield as a glowing cyan arc on
  one side of the ship, flames on a burning room.
- **Comet warning:** 2.6 s before a comet hits, a big red arrow on that edge of the screen,
  pointing at the ship, with "TOP!" (or BOTTOM / FRONT / BACK) and a shrinking ring.
- **HUD (HTML over the canvas, top):** "Wave 3 of 6" with a bar for the wave's time left;
  the hull as a big bar with "Hull 72%"; the team score.
- **Crew strip (bottom):** one chip per station: its icon, the name of whoever's on it in
  their colour (or "autopilot"), and a flame if its room burns.
- **Pop-ups:** "Blocked!" (shield), "+1 star", "Hull hit!" float up from the ship.
- **Between waves (7 s, 10 s before wave 1):** "Wave 2: comets!" with one line about what's
  new, and the new crew list ("Ana → Shields").
- **End:** "Home safe!" or "The ship was lost in wave 4", the team score, and a crew log:
  each person's rocks shot, comets blocked, fires out, stars caught. 8 s, then `party.end`.

## Phones
Top: your colour dot and name, then your station in big letters with its icon ("SHIELDS")
and one line of what to do. The station's controls fill the bottom half.
- **Helm:** joystick. "Engine on fire: the ship is slow!" when it is.
- **Gunner:** joystick to aim and fire, a heat bar under it; "Overheated!" for 2 s.
  "Guns jammed: fire in the gun room!" when it burns.
- **Shields:** four big arrow buttons in a cross, the active side lit; the current comet
  warning(s) above them with a countdown ("▲ TOP in 2 s"). "Shields offline: fire!" when the
  shield room burns.
- **Engineer:** three big room tiles (Engine, Guns, Shields), each showing its flames (a bar
  of 6); tap to douse. A **Patch hull** button (12 patches per wave) when nothing burns.
- **Navigator:** the next comets, earliest first, with side and seconds ("▶ FRONT in 4 s"),
  and the **Tractor beam** button (once per wave).
- **Between waves:** "Next wave you're on: GUNNER" with its one-line how-to. **End:** the
  team result and your own log line.

## Rules
1. 6 waves of 35 s, with a 7 s break between (10 s before the first). Hull starts at 100.
2. **Rocks** drift in from the front (from wave 4 also from above and below). The turret's
   shot splits a big rock in two and breaks a small one (+10 each). A rock that hits the
   ship: big −12 hull, small −6, and half the time it sets a random room on fire.
3. **Comets** come from one side: top, bottom, front (from wave 2), back (from wave 4).
   They can't be shot. If the shield faces that side when it hits (or did in the last
   0.35 s), it's blocked (+20). If not: −15 hull and a fire.
4. **Fires:** a room's fire has 6 flames; each engineer tap puts out one. A new hit on a
   burning room adds 2. Each burning room costs 1 hull a second. Fires go out between waves
   (the crew patches up in the break). Engine fire: the ship
   steers at a third of its speed. Gun fire: the turrets jam. Shield fire: no shield.
5. **Stars** (+25) float by; **repair kits** (+15 hull, from wave 3) now and then. The helm
   catches them by flying into them; the navigator's tractor beam pulls all of them in.
6. **Heat:** each shot adds heat; letting go cools it. Full heat: 2 s overheated.
7. Hull 0: the ship is lost and the game ends. Surviving wave 6: home safe.
8. Waves get harder: rocks every 2.2 s in wave 1 down to every 1.0 s in wave 6; a comet
   every 9 s in wave 2 down to every 4 s in wave 6, two at once in waves 5 and 6.

## Ending and winner
- A team game: everyone wins or loses together. **Score** = 10 per rock, 20 per comet
  blocked, 25 per star, 100 per wave survived, + the hull left at the end.
- `party.end`: rankings in seat order, every player gets the team score (so the lobby shows
  the whole crew sharing the result).

## Length
- 10 s + 6 × 35 s + 5 × 7 s + 8 s end ≈ **4.4 min** if they make it home; less if the ship
  is lost. `minutes: [3, 5]`.

## Art
- **Palette:** space violet `#140b2e` → `#2a1150`, hull cream `#ffe7c2`, stripe orange
  `#ff7a3d`, shield cyan `#5ce1ff`, comet white-cyan, rocks dusty purple-grey `#8a7f9e`,
  warning red `#ff3b5c`, star yellow `#ffd23f`, repair green `#3ddc84`.
- **Style:** chunky, rounded, toy-like: the tug is a fat capsule with a round cockpit and a
  glowing engine; rocks are lumpy polygons that tumble; everything has a dark outline so it
  reads from the couch.
- **Motion:** the screen shakes on a hit, the shield flashes on a block, flames flicker,
  the warning arrow pulses, stars twinkle. A quick red edge flash when the hull is low.
- **Sound (big screen):** `go` at a wave start, `blip` for a comet warning, `pop` for a
  block, `buzz` for a hit, `coin` for a star, `win`/`lose` at the end. Phones: `tap` on the
  shield and engineer buttons (a phone can only play after a tap anyway).

## Why these choices
- **Deciding, not twitching:** a phone's input lands 0.05–0.15 s late and nobody looks at
  their thumbs. So: rocks are slow and their hitboxes generous, comets are announced 2.6 s
  ahead (and the shield check looks back 0.35 s), the gunner aims a direction rather than
  tapping at the right moment, and the engineer's job is choosing which fire matters.
- **Talking is the game:** the navigator alone sees comets early, the engineer alone sees
  how bad each fire is, and a fire disables someone else's station, so people have to call
  things out to each other.
- **Autopilot and rotation** make 2 players work and let a phone drop out mid-wave
  without breaking the ship, and rotation means everyone gets the fun stations.
- **Team score for all:** the result is shared, which is the point of co-op; the crew log
  gives each person credit without ranking them against each other.

## Closest example
Bumper Blobs (real-time canvas, joystick). Built: one file, ~51 KB.

## Edge cases
- **A player leaves:** their station goes on autopilot ("autopilot" on the crew strip),
  their inputs reset. Back: their phone redraws from its state and takes the station back.
- **Nobody does anything:** autopilot alone usually loses the ship by wave 3–4; every phase
  has a timer, so the game always ends.
- **1 player:** the first core station is crewed, the rest autopilot (not a supported
  count, but nothing breaks).
- **Big screen reload:** `party.save` keeps wave, phase, hull, score, fires, the crew log
  and per-wave counters (patches, tractor). Rocks and comets aren't saved: a wave that was
  cut off starts again (a short "Back on course" break first), with the hull as it was.

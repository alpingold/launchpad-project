# Example designs in the design prompt (2026-10-15)

Do the example designs in the design step's prompt help, or make the model copy them? (plan
§13n). **Decided: no example designs**; the switch that brought them back (`examples: true`)
was removed on 2026-10-19.

**What the live F5 test showed:** both live designs copied their closest example closely (the
platformer took Tower Dash's 48-tile scale and physics; the RPG took Dungeon Party's four
classes, 30 s turns and Defend-on-timeout). On `main`, examples were the biggest lever on
*working code* (§11g, §12j). So the two steps may want different things:
- **Design step:** example designs mostly cause copying; the design format already teaches
  the structure. Candidate: no example designs (maybe one short sample from a game unlike
  any we'd want copied). Cheap to measure: the same 4–5 ideas with and without (~40 s each).
- **Build step:** examples teach the SDK, saving and reloads. Removing them probably means
  more failed attempts; measure later (each build ~10 min).

**Result of the design experiment (2026-10-15, qwen3.8:27b, 5 ideas × with/without the
example designs, one design each, all passed the heading check in 32–72 s):**

| Idea | With examples | Without |
|---|---|---|
| Racing platformer | ASCII, Tower Dash's 7 tiles/s | canvas, its own physics |
| Fantasy RPG | Knight/Mage/Cleric/Rogue (+2 more) | no classes: the room votes as one party |
| Cooking | real-time orders | rounds per order |
| Space shooter | similar either way (canvas, joystick) | similar |
| Thief mystery | similar either way (alibi cards) | similar |

- **Copying is real but narrow:** where an example is close (platformer, RPG), it supplies
  the specifics: numbers, class lists, ASCII. Without it the model invents its own.
- **The names still anchor it:** without the designs, it still names `bumper-blobs` and
  `dungeon-party` as closest examples, because DESIGN.md lists them. That's harmless (the
  build step needs the choice), but it shows how much the prompt's words steer.
- **Designs without examples are ~20% longer** and sometimes slower (up to 72 s).
- **Length is short either way** except the RPGs: 1.5–7 min for the party games, even with
  the Length heading. So option 2 (a default target) looks needed regardless.
- One hallucination: a "with" design claimed Dungeon Party has a secret thief role.

**Decided (2026-10-15):** the design step leaves the example designs out by default (the job
switch `examples: true` brings them back); the build step keeps its example game. And the
rulebook gets the default length target (option 2 above).

**Check of the length target (2026-10-15, the three shortest ideas again, no examples):**
cooking 4 → 6.5 min, space shooter 2 → 4.5–6 min, thief mystery 5.5–7 → **2 min**. It helps
but doesn't hold: the model calls 4.5 min "within 5–15", and for the thief it shortened the
game and argued that "a session plays 3–5 games". Ideas for next time: a fixed
"Total: about N min" line the server reads and shows on the admin page (flagged when outside
the target), or option 3 (a length choice), so the target is an input, not a hint.

# Typed actions, views as plain data, one timer

Decided 2026-11-16, designing SDK v1 from a blank file.

- **Typed actions.** A Game declares everything a Player can do as one `Action` type. Each button,
  text box, drawing pad and tappable shape carries the exact Action it sends. The alternative,
  parts with string ids that the logic matches by name, lets a view and its handler disagree until
  a simulated Match happens to press that button. Here the mistake is a compile error, and `tsc` is
  far cheaper than a Match, which matters most when a small model writes the Game.
- **Views are object literals.** There are no builder functions to import: a view is exactly the
  data that gets sent. Fewer names for a model to invent, and nothing between the code and the wire.
- **One timer per Match.** A Step may start it (replacing one running), stop it or leave it. Phase
  games almost always have one deadline, and replacing the timer on a phase change removes the bug
  where an old named timer fires into a new phase. A Game that wants two clocks at once can't have
  them; named timers can be added without breaking this.
- **The platform keeps the Player list.** Every function is handed the Players in the Match, so no
  Game maintains its own roster through joins and leaves.
- **Optional functions mean something.** A Game with `onJoin` takes late joiners. There is no flag
  that could contradict the code. `onLeave` is required, so no Game forgets that people leave.
- **The Picture Part is the way out of the Kit.** Typed shapes at any position, each of which may
  carry an Action on a phone. Boards, maps, cards and dice need no new Part. The site draws the
  shapes itself from a fixed list, so this is still data and still not Game code on a phone.
- **A Game's Look is declared once:** four colours, one of the site's typefaces, a corner style.

## Consequences

- The site owns a renderer for untrusted shapes. It must only ever create the listed elements with
  the listed attributes.
- Within SDK v1 the view format may only grow, because phones always draw with the site's current
  code while a Game keeps the Engine it was checked with.

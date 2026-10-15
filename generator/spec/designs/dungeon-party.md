# Dungeon Party

## Genre and feel
A co-op dungeon crawl drawn in text characters: explore together, vote on doors, and fight
monsters turn by turn. Friendly and a little dramatic, with a dragon at the end.

## Players
1–6. Monsters get more health with more heroes; with 1–2 heroes they hit softer.

## Big screen
- The dungeon map with `party.ui.ascii`: rooms appear as the party finds them; `@` is the
  party, monsters are letters (`g` goblin, `x` spider, `s` skeleton, `D` dragon).
- Beside it: the heroes and monsters with health bars, whose turn it is with a
  `party.ui.timer`, and a battle log of the last 6 lines.

## Phones
- The hero's card: name, class, health (and magic for the Mage).
- On their turn: **Attack** (with a target choice), their class's special, **Defend**.
- When voting: one button per door. Otherwise: what's happening.

## Rules
1. Each player gets a class in turn: Knight (40 HP, Shield Wall: everyone takes half damage
   this round), Mage (24 HP, Fireball: 4–7 to every monster for 3 of 9 MP), Cleric (30 HP,
   Heal: 8–12 to any hero, even one who is down), Rogue (28 HP, Sneak Attack: 8–12 to one
   monster, once per fight).
2. Six rooms: entrance, goblin den, spider nest, crypt, treasure room, dragon's lair.
3. In a fight, heroes act in order, then the monsters attack random heroes. The dragon
   breathes fire on everyone every third round.
4. Each hero has 30 s per turn; a slow turn defends automatically.
5. After a fight or the treasure: a 2.5 s pause, then everyone votes on a door (20 s; most
   votes wins, ties picked at random). Winning a fight heals everyone 30%.

## Ending and winner
The dragon dies: everyone wins together. Every hero is down:
the party loses. Either way, rankings and scores come from each hero's points: damage dealt,
healing done and a share of the treasure. A 7 s final screen, then `party.end`.

## Length
- A turn: at most 30 s, usually 5–10 s. A fight: about 3–5 rounds of every hero plus the
  monsters ≈ 1–3 min with 3 heroes. A vote: at most 20 s.
- The game: every path is 3 rooms after the entrance, ending in the lair, so 2–3 fights,
  plus votes and pauses ≈ 10–20 min. Win or lose, a 7 s final screen.

## Art
Text characters with `party.ui.ascii`; HTML for the side panel and phones.

## Template
`turns`: one hero acts at a time, with votes between rooms.

## Closest example
`none`: this is the RPG example itself.

## Edge cases
- A player who leaves defends automatically on their turn and doesn't vote.
- Nobody acts: turns and votes time out.
- 1 hero (softer monsters) up to 6 (tougher monsters).
- Big screen reload: the whole game state is saved after every action and carries on.

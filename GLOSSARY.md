# BoilerGames

Party games for one shared Screen and everyone's phones, and the tools that let people make their own: with the site's AI, or by uploading a Game they wrote.

## Rooms and people

**Room**:
A live gathering on one Screen that Players join with its Room Code. It runs one Match at a time.
_Avoid_: Session, server, party

**Lobby**:
The state of a Room between Matches, where Players gather and the Host picks a Game.
_Avoid_: Waiting room, menu

**Room Code**:
The short code shown on the Screen that Players type on their phones to join a Room.
_Avoid_: Join code, PIN

**Screen**:
The shared display (a laptop on a TV or projector) that runs a Room and shows the main game view.
_Avoid_: Big screen, host screen, TV

**Host**:
The person who opens a Room and controls it: picking Games, starting and stopping Matches, removing Players. The Screen's browser holds a secret host token that takes the Room back after a reload; without it, nothing can.
_Avoid_: Owner, admin, GM

**Player**:
A person who has joined a Room from their phone.
_Avoid_: User, participant, guest

**Seat**:
A Player's place in a Room, which keeps who they are through disconnects and reconnects. Its phone holds a secret seat token that takes the Seat back. Someone who arrives during a Match gets a Seat and plays from the next Match, unless the Game takes late joiners. A Player who stays away too long loses their Seat.
_Avoid_: Slot, session, spot, watcher

**Controller**:
The view on a Player's phone that they play through. The device itself is just "the phone".
_Avoid_: Gamepad, client, remote

## Games

**Game**:
Something a Room can play: made by a Generation, uploaded, or remixed. A Game is a list of Versions.
_Avoid_: App, experience, cartridge

**Official game**:
A Game the owner publishes as one of the site's own. Apart from its label, it is a Game like any other.
_Avoid_: Built-in game, first-party game, source

**Match**:
One play-through of one Game in one Room.
_Avoid_: Session, round, game (for a play-through)

**Version**:
One state of a Game's code, and how it got there. A Generation, a Revision, an Upload or a Remix's copy makes one; each after the first is made from an earlier one.
_Avoid_: Revision (that's the change asked for), build (that's one step of making one)

**SDK version**:
Which edition of the platform's game toolkit a Version was checked against. A Version always runs on that edition's Engine. Always the two words, never "version" alone.
_Avoid_: Version, runtime version

**Kit**:
The fixed set of Parts that every View is made of, drawn by the site and never by the Game.
_Avoid_: Components, widgets, blocks

**Part**:
One piece of a View: text, a button, a text box, a drawing pad, a timer, a scoreboard, a player list, a drawing, a Picture, a row.
_Avoid_: Component, widget, element

**Picture**:
The Part made of free-form shapes at any position, each of which a Player can tap on a phone. The way out when the other Parts aren't enough.
_Avoid_: Canvas, SVG, image

**View**:
What the Screen or one Controller shows at one moment, as plain data: a list of Parts. A Game returns Views; it never draws.
_Avoid_: Page, layout, UI

**Action**:
One thing a Player can do in a Game, as typed plain data. Each Part a Player can use carries the Action it sends.
_Avoid_: Input, event, move, message

**Step**:
What a Game's logic returns each time it is called: the new state, and optionally a timer change or the end of the Match.
_Avoid_: Update, result, tick

**Look**:
A Game's own colours, typeface and corner style, declared once and applied by the site to every Part.
_Avoid_: Theme, skin, style

**Engine**:
The site's code that runs a Match: it calls the Game's functions and checks everything they return. The same Engine runs in the Host's browser, in the Playtest and in tests.
_Avoid_: Runtime, runner, host

**Driver**:
Whatever runs the Engine and hands it each event: the Game frame in the Host's browser, the simulator in the Playtest, or a test. It owns the real clock: it starts the timer the Engine asks for and tells the Engine when it runs out.
_Avoid_: Host (that's the person), runner, harness

**Outcome**:
What the Engine reports after each event: the Match goes on (and what happens to its timer), the event was ignored and why, the Match ended and how, or it broke and why.
_Avoid_: Result, status, Step (that's what a Game returns)

**Stage**:
The space, 1,280 pixels wide, on which the site lays out the Screen's View before scaling it to fit the display and centring it. A Game draws for the Stage, never for a particular display.
_Avoid_: Canvas, viewport, screen size

**Game frame**:
The hidden, walled-off frame in the Host's browser where the Engine and the Game run. It shows nothing.
_Avoid_: Sandbox, iframe, game window

## Making games

**Creator**:
A signed-in person who makes a Game, by Generation, Upload or Remix.
_Avoid_: Maker, author, developer

**Purdue-verified**:
An account that has confirmed a Purdue email address. It is needed to Vote and to start a Generation. For now only Purdue addresses can sign in, so every account is Purdue-verified.
_Avoid_: Student account, verified

**Generation**:
The whole process of turning a Creator's idea into a Game: a Concept, the Creator's approval, then Builds and Playtests.
_Avoid_: Job, build, prompt

**Concept**:
The written design of a whole Game that a Generation drafts and the Creator approves (or edits, or sends back with a note) before any code is written. It is structured: a title, a pitch, a Player count, its phases in order (each with an id the Game's state uses), its scoring, its length and its Look, so the Playtest can check the Game against it.
_Avoid_: Design, idea, spec, pitch

**Build**:
The step where the AI writes a Game's code, from the approved Concept or a Revision. When a Playtest fails, its problems go back to Build, a few times at most.
_Avoid_: Compile, codegen

**Playtest**:
An automated run of a Game with simulated Players, from start to finish, to check that it works before the Creator gets it.
_Avoid_: Test run, validation, QA

**Revision**:
A change to one ready Version of a Game that its Creator asks for in plain words, made without rebuilding from the Concept. It makes a new Version, which isn't published; a failed one leaves the Game as it was.
_Avoid_: Edit, patch, tweak

**Plan**:
The written plan of one Revision, against the Game's Concept. A small fix has no Plan. Not built yet: for now no Revision has a Plan.
_Avoid_: Change design, diff

**Upload**:
A Version whose code its Creator brought (written by hand, or with an AI of their own), checked like any other but never written by the site's AI.
_Avoid_: Import (that's an admin's copy of a file)

**Remix**:
A Creator's own copy of someone else's public Game, to play and change as their own. It credits the Game it was copied from.
_Avoid_: Fork, clone

**Track**:
The page a Creator follows a Generation or a Revision on: where it is (Concept, Build, Playtest, ready) and whether it is waiting on the AI, on its Creator, or failed and why, with each step it took and the problems each found.
_Avoid_: Progress bar, pipeline

**Made by**:
How a Game was made, for its label: "AI-made" when a Generation or Revision built any Version of it, "Uploaded" when it was brought as code, and for a Remix, however its original was made.
_Avoid_: Source, origin

## The Library

**Library**:
The shared collection of published Games that any Host can choose from. A Game is private to its Creator until they publish it.
_Avoid_: Catalog, games page, store

**Counted play**:
A Match of a published or Official game that reached its end with at least the Game's fewest Players. A Game's page shows how many it has had, as "about N plays": the Host's browser reports a Match's end, so the number is approximate.
_Avoid_: Hit, visit, session

**Profile**:
A Creator's public page: their name, description and published Games.
_Avoid_: Account page, user page, bio

**Vote**:
A Purdue-verified account's up or down vote on someone else's Game in the Library; at most one per Game.
_Avoid_: Like, rating, score

**Voted off**:
A published Game whose Vote total is at or below −5. It is left out of the Library until its total rises.
_Avoid_: Hidden, banned, removed

**deleted user**:
How the Library credits a published Game whose Creator deleted their account and chose to leave it up. Nobody can change such a Game.
_Avoid_: Anonymous, orphaned

## Trust and safety

**Admin**:
A club member who can unpublish any Game. The owner grants and revokes it.
_Avoid_: Moderator, mod, staff

**Game report**:
A Player's note that a Game is broken or offensive; its **reason** says which.
_Avoid_: Flag, complaint, kind

**Site report**:
A note to the owner about the site itself, sent with or without an account; its **topic** is broken, idea or other.
_Avoid_: Feedback, ticket, kind

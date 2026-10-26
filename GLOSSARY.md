# BoilerGames

Party games for one big screen and everyone's phones, and the tools that let people make their own: with the site's AI, or by uploading a game file.

## Making games

**Version**:
One state of a player-made game: its code, and how it got there. A game is a list of versions; each one after the first is made from an earlier one.
_Avoid_: revision, build (a build is one step that makes a version's code)

**Version kind**:
What a version is: a new game, a change, a "Review again" round, a remix's own design ("Make it your own"), a remix's copy, or an uploaded file. With the version's status it decides the version's next step, whether that step needs the AI, whether it has a design, and its track.
_Avoid_: version type, mode

**Design**:
The written plan of a whole game (its rules, screens, art and length), read and approved before any code is written. A new game and a remix made its own have one; an uploaded file has none.
_Avoid_: spec, outline

**Plan**:
The written plan of one change to a game, against its design. A small fix has no plan.
_Avoid_: change design, diff

**Upload**:
A version whose game file its creator brought (written by hand, or with an AI of their own), checked like any other but never written by the site's AI.
_Avoid_: import (that's an admin's command-line copy of a file)

**Remix**:
A player's own copy of someone else's public game, to play and change as their own. It credits the game it was copied from.
_Avoid_: fork, clone

**Track**:
The board the maker's page shows for a version: Idea → Design → Build → Play for a new game, Change → Plan → Build → Play for a change, Upload → Check → Play for an upload, with where the version is and whether it's waiting for the AI, for its creator, or failed.
_Avoid_: progress bar, pipeline

**Made by**:
How a game was made, for its label: "AI-made" when the site's AI built any version of it, "Uploaded" when it was brought as a file, and for a remix, however its original was made.
_Avoid_: source (that's official vs player-made), origin

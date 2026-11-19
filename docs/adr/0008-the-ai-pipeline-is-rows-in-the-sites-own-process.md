---
status: proposed
---

# The AI pipeline runs in the site's own process, as rows in the database

Drafted 2026-11-19 for milestone 3. **Proposed, not accepted:** the owner has not yet confirmed it.
`docs/BUILD-PLAN.md` ("Milestone 3: the AI") has the steps and the defaults still open.

A Generation (idea → Concept → the Creator's approval → Build → Playtest, with failures going back
to Build) is run by the one server process that already runs the site. Each thing it does is a row
in the database, written before and after, so a restart carries on from where each Generation was.

- **No second service and no queue product.** A model call is minutes of waiting, not of work, so
  the site's process can hold a few at once without slowing anything else. The queue is a count in
  memory and the rows themselves.
- **The model is behind one small interface**, as email is: the real client for GenAI Studio, and a
  scripted fake for every test. The pipeline can be tested whole without the internet.
- **Only the Playtest runs what the model writes.** Generated code is a stranger's code, exactly as
  an Upload is. It runs in the walled runner and in the Game frame, and nowhere else. The rest of
  the pipeline only passes text.
- **The Playtest is the only judge.** There is no AI review of the code. A generated Game is also
  checked against its Concept (each phase reached, scores moving if it has scoring), which an
  Upload is not.
- **Creators bring their own GenAI Studio key**, so the site pays for no model calls. A key is
  encrypted with a secret kept in a file on the server, outside the database and its backups.
- **Off unless configured.** Without the secret and the model's settings the site runs as before,
  with the AI maker switched off.

## Why not what the experiment did

The experiment (`~/slopProjects/boilergamesretry`) ran each Generation as a cloud function that
could pause for days, kept progress in a cloud database, and encrypted keys with a cloud key
service. That suits a site built from cloud functions. This site is one process on one server with
one database file, and adding three services to it for a club-sized load would be three more things
to run, pay for and explain.

## What we give up

- A restart repeats the model call that was under way, which costs the Creator a few minutes.
- Losing the server loses the key secret, and Creators enter their keys again. A backup alone can
  never reveal a key, which is the point.
- At most a few Generations run at once. More would need more than one server, which nothing else
  about the site is ready for either.

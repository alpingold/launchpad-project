---
status: accepted
---

# Node's built-in SQLite and plain SQL for the database

Decided 2026-11-17 with the owner, at the start of milestone 2. It replaces ADR 0002.

The database is still SQLite, one file on the one server: it suits a club-sized site, and a backup
is a file copy. We reach it through `node:sqlite`, the SQLite that comes with Node 24, and write
the SQL by hand. Nothing is installed for it.

- **Tables** are created by numbered `.sql` files (`0001-accounts.sql`, ...), applied in order
  when the server starts, each in one transaction. The database records which have run. A file
  that has shipped is never edited: a change is a new file.
- **Queries** live in one module per subject (accounts, games), which is the only code that
  contains SQL. Each query is a named function that takes and returns plain typed objects.
- **Rows are checked.** Every row read is parsed with a Zod schema before the rest of the server
  sees it, so the TypeScript type is a fact about the data and not a hope.
- **Tests run on a real database** in memory, through the same migration files, so a query that
  doesn't match its table fails a test.

## Why not Drizzle (ADR 0002)

Drizzle's draw was that the tables are written once and the row types follow from them. Two things
weighed more:

- **It needs a native package.** Drizzle on `better-sqlite3` brings a compiled module that must
  match the machine. Releases are built on GitHub's x86 machines and run on an ARM server, so the
  release would have to be built differently just for the database. `node:sqlite` is part of Node.
- **It is one more thing to explain.** The owner defends this design to a mentor. "The server
  runs these SQL statements" is plainer than a library's way of spelling the same statements, and
  the site has about five tables.

What we give up: the SQL and the types are kept in step by tests and by the row schemas, not by
construction. If the tables grow to where that hurts, a query builder can be added over the same
database without changing it.

## Consequences

- Node marks `node:sqlite` as not yet fully stable. We use only its plain core (open, prepare,
  run, get, all, transactions), and pin Node's version on the server (`deploy/setup-server.sh`).
- Rolling a release back does not roll the database back. So a migration must leave the database
  usable by the release before it: add tables and columns, and remove or rename only in a later
  release, once nothing reads the old name. The server copies the database file before it applies
  any migration.
- Rooms are not in the database. They stay in memory (ADR 0005).

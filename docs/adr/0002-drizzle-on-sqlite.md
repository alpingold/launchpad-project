---
status: proposed
---

# Drizzle on SQLite for the database

Decided 2026-10-30, for the rewrite (ADR 0001). The database stays SQLite, a single file on the
one server: it suits a club-sized site, and a backup is a file copy. We talk to it through Drizzle
on better-sqlite3. The tables are written once, in TypeScript, and the row types and the SQL
migrations (written by `drizzle-kit`, a dev-only tool) come from them, so a table change can't
silently miss its types. The queries still look like SQL. It stays "proposed" until the
data model is designed with the owner, before milestone 2.

## Considered options

- **Kysely:** a typed query builder, even closer to SQL, but the table types are written by hand
  or generated from the database.
- **Prisma:** its own schema language, generated code and a query engine; the heaviest option,
  and it hides the most SQL.
- **No ORM:** hand-written SQL with a Zod schema for each row; the SQL and the types can drift.
- **Postgres instead of SQLite:** a second service to run, secure and back up, for scale the site
  doesn't need.

/**
 * Every row read from the database is parsed with a Zod schema before the rest of the server sees
 * it, so a row's TypeScript type is a fact about the data, not a hope (ADR 0007). A row that
 * doesn't match throws: the table and the code disagree, and carrying on would spread the mistake.
 */
import type { z } from "zod";

/** The row, parsed, or undefined if there was none. */
export function one<S extends z.ZodType>(schema: S, row: unknown): z.output<S> | undefined {
  return row === undefined ? undefined : schema.parse(row);
}

/** Every row, parsed. */
export function all<S extends z.ZodType>(schema: S, rows: readonly unknown[]): z.output<S>[] {
  return rows.map((row) => schema.parse(row));
}

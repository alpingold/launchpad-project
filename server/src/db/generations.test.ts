// The queries about Generations: finding the one that made a Version reads an index, not every
// Generation on the site.
import { expect, test } from "vitest";
import { IN_MEMORY, openDatabase } from "./database.js";

test("the Generation that made a Version is found by an index", () => {
  const db = openDatabase({ file: IN_MEMORY, log: () => undefined });
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT concept FROM generations WHERE version_id = ? AND state = 'ready'").all("v1");
  expect(plan.map((row) => String(row["detail"]))).toEqual([expect.stringMatching(/USING INDEX generations_by_version/)]);
});

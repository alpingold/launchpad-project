/**
 * The queries about counted plays: one number per Game (BUILD-PLAN Step 18). With database.ts, the
 * only file with SQL about them. What counts as a play is decided in plays.ts, not here.
 */
import { z } from "zod";
import type { Database } from "./database.js";
import { one } from "./rows.js";

/** What a count belongs to: a Game's id, or an Official game's name, which has no row in `games`. */
export type PlaySubject = { readonly gameId: string } | { readonly official: string };

/** The text the table keeps for a subject. */
function subjectText(subject: PlaySubject): string {
  return "official" in subject ? `official:${subject.official}` : subject.gameId;
}

/** One more play: the subject's row is made the first time. */
export function addPlay(db: Database, subject: PlaySubject): void {
  db.prepare("INSERT INTO plays (subject, count) VALUES (?, 1) ON CONFLICT (subject) DO UPDATE SET count = count + 1").run(subjectText(subject));
}

/** How many plays the subject has had: 0 if none. */
export function playsOf(db: Database, subject: PlaySubject): number {
  return one(z.object({ count: z.number().int() }), db.prepare("SELECT count FROM plays WHERE subject = ?").get(subjectText(subject)))?.count ?? 0;
}

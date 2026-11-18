/**
 * What a Playtest says is wrong. The problems are the product: a Creator, and later the site's AI,
 * fixes the Game from this text alone, so each says what is wrong and where, in the SDK's words.
 */
import { MAX_PROBLEMS } from "./limits.js";

export interface Problem {
  /** Which stage found it: the source itself, the type check, the bundle, or playing it. */
  readonly stage: "source" | "types" | "bundle" | "play";
  readonly message: string;
  /** The line of the Game's file it is on, when it is on one. */
  readonly line?: number;
}

/** At most MAX_PROBLEMS: the first ones, and a last one saying how many more there were. */
export function capped(problems: readonly Problem[]): Problem[] {
  if (problems.length <= MAX_PROBLEMS) return [...problems];
  const kept = problems.slice(0, MAX_PROBLEMS - 1);
  const last = problems[MAX_PROBLEMS - 1];
  return [...kept, { stage: last?.stage ?? "play", message: `...and ${problems.length - kept.length} more problems, not shown. Fix these first.` }];
}

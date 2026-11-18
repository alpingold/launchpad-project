/**
 * The queue of Versions waiting for their Playtest. The Version's row is the truth: a Version is
 * waiting for as long as it is `checking`, so at start the queue is every such row (a restart, and
 * every deploy is one, loses nothing), and a result is written in one statement with its state.
 *
 * At most MAX_CHECKS_AT_ONCE Playtests run at once, and at most one for any one account, so one
 * Creator uploading many times can't make everyone else wait behind them.
 */
import { CHECK_FAILED, type PlaytestRunner, type RunResult } from "@boilergames/playtest/client";
import type { Database } from "./db/database.js";
import { finishCheck, sourceToCheck, versionsToCheck } from "./db/games.js";
import type { Clock } from "./rooms.js";

/** How many Playtests run at once: the Playtest's socket runs two (MaxConnections=2). */
export const MAX_CHECKS_AT_ONCE = 2;
/** How many Versions may wait in the queue in all, before Uploads are refused for a while. */
export const MAX_WAITING = 20;

interface Waiting {
  readonly versionId: string;
  readonly ownerId: string;
}

export class Checks {
  readonly #waiting: Waiting[] = [];
  /** The accounts whose Playtest is running now. */
  readonly #running = new Set<string>();
  #stopped = false;
  /** Every Playtest running now: a test can wait for them. */
  readonly #inFlight = new Set<Promise<void>>();

  constructor(
    private readonly database: Database,
    private readonly playtest: PlaytestRunner,
    private readonly clock: Clock,
  ) {
    for (const waiting of versionsToCheck(database)) this.#waiting.push(waiting);
    this.#next();
  }

  /** How many Versions are waiting, not counting those being checked now. */
  get waiting(): number {
    return this.#waiting.length;
  }

  add(versionId: string, ownerId: string): void {
    this.#waiting.push({ versionId, ownerId });
    this.#next();
  }

  /**
   * Stops starting Playtests. One that finishes after this writes nothing: its Version stays
   * `checking`, and the next start checks it again.
   */
  stop(): void {
    this.#stopped = true;
  }

  /** Resolves when nothing is running and nothing that could run is waiting. For tests. */
  async settled(): Promise<void> {
    while (this.#inFlight.size > 0) await Promise.all(this.#inFlight);
  }

  #next(): void {
    while (!this.#stopped && this.#running.size < MAX_CHECKS_AT_ONCE) {
      const at = this.#waiting.findIndex((waiting) => !this.#running.has(waiting.ownerId));
      if (at < 0) return;
      const [chosen] = this.#waiting.splice(at, 1);
      if (chosen === undefined) return;
      this.#running.add(chosen.ownerId);
      const run = this.#check(chosen.versionId).finally(() => {
        this.#running.delete(chosen.ownerId);
        this.#inFlight.delete(run);
        this.#next();
      });
      this.#inFlight.add(run);
    }
  }

  async #check(versionId: string): Promise<void> {
    const source = sourceToCheck(this.database, versionId);
    if (source === undefined) return;
    let result: RunResult;
    try {
      result = await this.playtest.run(source);
    } catch (error) {
      // The runner promises never to throw; if it does, it is the check failing, not the Game.
      console.error(`Playtest: the runner threw: ${(error as Error).message}`);
      result = { ok: false, checkFailed: true, problems: [{ stage: "play", message: CHECK_FAILED }] };
    }
    if (this.#stopped) return;
    const checkedAt = Math.floor(this.clock.now() / 1000);
    finishCheck(this.database, versionId, result.ok ? { ok: true, bundle: result.bundle, about: result.about } : { ok: false, problems: result.problems }, checkedAt);
  }
}

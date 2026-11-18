/**
 * A limit on how often something may happen per key (an email address, a visitor's address, or one
 * key for the whole site) within a sliding window: at most `max` in any `windowMs`.
 *
 * Kept in memory, like the Room limits: a restart forgets them. That lets someone who knew when the
 * server restarts send one more burst, which is acceptable for limits whose job is to stop a flood.
 */
import type { Clock } from "./rooms.js";

export class WindowLimit {
  readonly #events = new Map<string, number[]>();

  constructor(
    readonly max: number,
    readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  /** How long, in milliseconds, until `key` may have another: 0 if it may now. */
  wait(key: string): number {
    const recent = this.#recent(key);
    if (recent.length < this.max) return 0;
    // The oldest of the last `max` must leave the window first.
    return (recent[recent.length - this.max] ?? 0) + this.windowMs - this.clock.now();
  }

  record(key: string): void {
    const recent = this.#recent(key);
    recent.push(this.clock.now());
    this.#events.set(key, recent);
  }

  /** Forgets every key with nothing left in its window, so one-time visitors don't pile up. */
  sweep(): void {
    for (const key of [...this.#events.keys()]) if (this.#recent(key).length === 0) this.#events.delete(key);
  }

  #recent(key: string): number[] {
    const since = this.clock.now() - this.windowMs;
    const recent = (this.#events.get(key) ?? []).filter((at) => at > since);
    if (recent.length === 0) this.#events.delete(key);
    else this.#events.set(key, recent);
    return recent;
  }
}

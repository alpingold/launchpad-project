/**
 * Counts attempts per key (an IP address) in fixed time windows, e.g. "10 per 15 minutes".
 * Used to slow down password guessing and mass account creation.
 *
 * Kept in memory: a server restart resets the counts, which is fine for this purpose.
 * Note: many people behind one network (e.g. campus Wi-Fi) can share one public IP, so
 * the limit counts only failed logins and sign-ups, not successful logins.
 */
export class AttemptLimiter {
  /** @param {{ max: number, windowMs: number, now?: () => number }} opts */
  constructor({ max, windowMs, now = () => Date.now() }) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    /** @type {Map<string, { count: number, windowStart: number }>} */
    this.entries = new Map();
  }

  /** True if this key has used up its attempts in the current window. */
  isBlocked(key) {
    const entry = this.current(key);
    return entry !== null && entry.count >= this.max;
  }

  /** Records one attempt for this key. */
  record(key) {
    const entry = this.current(key);
    if (entry) entry.count++;
    else this.entries.set(key, { count: 1, windowStart: this.now() });
    if (this.entries.size > 10_000) this.prune(); // don't grow forever
  }

  /** The entry for this key if its window hasn't ended, else null (and forgets it). */
  current(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.windowStart >= this.windowMs) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  prune() {
    for (const key of [...this.entries.keys()]) this.current(key);
  }
}

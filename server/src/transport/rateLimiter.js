/**
 * Token bucket rate limiter, one per connection.
 *
 * Picture a bucket holding up to `burst` tokens. Each message costs one token.
 * Tokens drip back in at `ratePerSec`. A client can send a quick burst (e.g. several
 * taps at once) but can't keep up a high rate, because the bucket empties.
 *
 * `now` is injectable so tests can control time instead of waiting for real seconds.
 */
export class TokenBucket {
  /** @param {{ ratePerSec: number, burst: number, now?: () => number }} opts */
  constructor({ ratePerSec, burst, now = Date.now }) {
    this.ratePerSec = ratePerSec;
    this.burst = burst;
    this.now = now;
    this.tokens = burst; // start full
    this.lastRefill = now();
  }

  /** Spends one token if available. Returns false if the caller is over the limit. */
  tryRemoveToken() {
    const t = this.now();
    const elapsedSec = (t - this.lastRefill) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsedSec * this.ratePerSec);
    this.lastRefill = t;

    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

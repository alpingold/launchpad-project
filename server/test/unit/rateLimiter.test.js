import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket } from '../../src/transport/rateLimiter.js';

/** A clock the test moves by hand. */
function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms) => (t += ms) };
}

test('allows a burst, then blocks', () => {
  const clock = fakeClock();
  const bucket = new TokenBucket({ ratePerSec: 2, burst: 3, now: clock.now });
  assert.equal(bucket.tryRemoveToken(), true);
  assert.equal(bucket.tryRemoveToken(), true);
  assert.equal(bucket.tryRemoveToken(), true);
  assert.equal(bucket.tryRemoveToken(), false);
});

test('refills over time at the given rate', () => {
  const clock = fakeClock();
  const bucket = new TokenBucket({ ratePerSec: 2, burst: 3, now: clock.now });
  for (let i = 0; i < 3; i++) bucket.tryRemoveToken();

  clock.advance(499); // 0.998 tokens: not quite one
  assert.equal(bucket.tryRemoveToken(), false);
  clock.advance(1); // now a full token
  assert.equal(bucket.tryRemoveToken(), true);
  assert.equal(bucket.tryRemoveToken(), false);
});

test('never holds more than the burst size', () => {
  const clock = fakeClock();
  const bucket = new TokenBucket({ ratePerSec: 10, burst: 2, now: clock.now });
  clock.advance(60_000); // a long idle period
  assert.equal(bucket.tryRemoveToken(), true);
  assert.equal(bucket.tryRemoveToken(), true);
  assert.equal(bucket.tryRemoveToken(), false);
});

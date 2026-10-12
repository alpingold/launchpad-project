import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AttemptLimiter } from '../../src/auth/attemptLimiter.js';

function setup() {
  let t = 0;
  const limiter = new AttemptLimiter({ max: 3, windowMs: 1000, now: () => t });
  return { limiter, advance: (ms) => (t += ms) };
}

test('blocks after max attempts, per key', () => {
  const { limiter } = setup();
  for (let i = 0; i < 3; i++) {
    assert.equal(limiter.isBlocked('1.2.3.4'), false);
    limiter.record('1.2.3.4');
  }
  assert.equal(limiter.isBlocked('1.2.3.4'), true);
  assert.equal(limiter.isBlocked('5.6.7.8'), false, 'other addresses unaffected');
});

test('the block lifts when the window ends', () => {
  const { limiter, advance } = setup();
  for (let i = 0; i < 3; i++) limiter.record('ip');
  advance(999);
  assert.equal(limiter.isBlocked('ip'), true);
  advance(1);
  assert.equal(limiter.isBlocked('ip'), false);
});

test('old entries are forgotten', () => {
  const { limiter, advance } = setup();
  limiter.record('a');
  limiter.record('b');
  advance(1000);
  limiter.prune();
  assert.equal(limiter.entries.size, 0);
});

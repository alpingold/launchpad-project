import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGenaiStatus } from '../../src/generation/genaiStatus.js';

// Is GenAI Studio up (plan §53)? Any answer is "up"; no answer, a network error or a 5xx is "down".

function status(answers) {
  let t = 1000;
  const logged = [];
  const fetchImpl = async () => {
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return { status: a };
  };
  const s = createGenaiStatus({ url: 'https://genai.example/', intervalMs: 60_000, timeoutMs: 10, fetchImpl, now: () => (t += 1000), log: (m) => logged.push(m) });
  return { s, logged };
}

test('not checked yet: unknown; then any answer is up, and 5xx or no answer is down', async () => {
  const { s, logged } = status([401, 200, 503, new Error('timed out'), 302]);
  assert.deepEqual(s.status(), { up: null, checkedAt: null, since: null });
  assert.equal((await s.check()).up, true, '401: up (it answered; the key is the page\'s business)');
  const first = s.status().since;
  assert.equal((await s.check()).up, true);
  assert.equal(s.status().since, first, 'still up: since stays');
  assert.equal((await s.check()).up, false, '503');
  assert.equal((await s.check()).up, false, 'no answer');
  assert.equal((await s.check()).up, true, 'a redirect is an answer');
  assert.deepEqual(logged, ['[genai] GenAI Studio is down', '[genai] GenAI Studio is back up']);
});

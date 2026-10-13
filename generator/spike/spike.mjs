// A0 spike: run inside an OpenShell sandbox to prove the setup does what plan §11 needs.
//
//   node /app/spike.mjs [model]
//
// Checks, in order:
//  1. The API key inside the sandbox is a placeholder, not the real key.
//  2. GenAI Studio is reachable and lists the models this key may use.
//  3. A tiny chat request works (with [model], default gpt-oss:120b).
//  4. Any other website is blocked.
//  5. The sandbox can't write outside its allowed folders.

import { writeFileSync } from 'node:fs';

const BASE = 'https://genai.rcac.purdue.edu/api';
const model = process.argv[2] ?? 'gpt-oss:120b';
const key = process.env.GENAI_API_KEY ?? '';
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

function report(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
}

// 1. Real GenAI Studio keys start with "sk-". A placeholder shouldn't.
//    Only the first 6 characters are printed, so a real key would never be shown in full.
report(key.length > 0 && !key.startsWith('sk-'), 'key is a placeholder', `starts with "${key.slice(0, 6)}…"`);

// 2. List models.
try {
  const res = await fetch(`${BASE}/models`, { headers });
  const body = await res.json();
  const ids = (body?.data ?? []).map((m) => m.id);
  report(res.ok && ids.length > 0, 'GenAI Studio reachable', `HTTP ${res.status}, ${ids.length} models`);
  if (ids.length) console.log(`      models: ${ids.join(', ')}`);
} catch (err) {
  report(false, 'GenAI Studio reachable', err.cause?.message ?? err.message);
}

// 3. Tiny chat request.
try {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: 'Reply with just the word OK.' }] }),
  });
  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content;
  report(res.ok && typeof text === 'string', `chat with ${model}`, `HTTP ${res.status}, reply: ${JSON.stringify(text ?? body)}`.slice(0, 200));
} catch (err) {
  report(false, `chat with ${model}`, err.cause?.message ?? err.message);
}

// 4. Another website must be blocked.
try {
  const res = await fetch('https://example.com', { signal: AbortSignal.timeout(10_000) });
  report(res.status === 403, 'other websites blocked', `got HTTP ${res.status} (403 = blocked by OpenShell)`);
} catch (err) {
  report(true, 'other websites blocked', `connection refused (${err.cause?.code ?? err.message})`);
}

// 5. Writing outside the allowed folders must fail.
try {
  writeFileSync('/app/should-not-exist.txt', 'x');
  report(false, 'filesystem locked down', 'was able to write to /app');
} catch (err) {
  report(true, 'filesystem locked down', `write to /app refused (${err.code})`);
}

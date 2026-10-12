let counter = 0;

/** A username no other test has used (tests share one in-memory DB per server). */
export function uniqueUsername(prefix = 'host') {
  counter++;
  return `${prefix}_${process.pid % 1000}_${counter}`;
}

/** POSTs JSON to the test server. */
export function postJson(baseUrl, path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** The "sid=..." part of a response's Set-Cookie header, ready to send back as a Cookie header. */
export function cookieFrom(res) {
  const setCookie = res.headers.get('set-cookie');
  return setCookie ? setCookie.split(';')[0] : null;
}

/**
 * Creates an account on the test server and returns its login cookie ("sid=...").
 * Use it as { headers: { Cookie: cookie } } for a WebSocket that needs to host.
 */
export async function signUp(baseUrl, username = uniqueUsername(), password = 'test-password-123') {
  const res = await postJson(baseUrl, '/api/signup', { username, password });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  return cookieFrom(res);
}

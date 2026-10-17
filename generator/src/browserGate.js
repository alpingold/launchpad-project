// The browser gate (plan §28): jobs share ONE headless browser slot on the server.
//
// A job spends most of its time waiting for the AI (~70 MB), and a few seconds playtesting
// in headless Chrome (~450 MB and the CPU). So many jobs may run at once, but only one
// browser check at a time. The sandbox can't reach the server, so the job asks over the
// pipes it already has:
//
//   job → server (stderr):  BROWSER? <token>       "may I start the browser?"
//   server → job (stdin):   BROWSER! <token>       "yes, go"
//   job → server (stderr):  BROWSER done <token>   "finished, next please"
//
// The token is random per job and known only to the server and this process, never to the
// game being tested, so nothing a game prints can fake these lines. Without a token (the
// `npm run generate` script, tests) there's no gate: the check runs straight away.

/** A gate that never waits. */
export const NO_GATE = { acquire: async () => {}, release: () => {} };

/** A token is 32 hex characters (randomBytes(16) on the server). */
export const isGateToken = (value) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);

/**
 * Reads a stream line by line, on demand: the job is the first line, the server's answers
 * are the ones after it.
 * @param {NodeJS.ReadableStream} stream
 */
export function lineReader(stream) {
  const lines = [];
  /** @type {((line: string | null) => void)[]} */
  const waiting = [];
  let buffer = '';
  let ended = false;
  const push = (line) => (waiting.length > 0 ? waiting.shift()(line) : lines.push(line));
  stream.setEncoding?.('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop();
    for (const part of parts) push(part);
  });
  stream.on('end', () => {
    if (buffer.length > 0) push(buffer); // a last line with no line break (an older server)
    buffer = '';
    ended = true;
    while (waiting.length > 0) waiting.shift()(null);
  });
  return {
    /** The next line, or null once the stream has ended. */
    next() {
      if (lines.length > 0) return Promise.resolve(lines.shift());
      if (ended) return Promise.resolve(null);
      return new Promise((resolve) => waiting.push(resolve));
    },
  };
}

/**
 * The gate for a job the server started with a token.
 * @param {string} token
 * @param {{ lines: ReturnType<typeof lineReader>, write: (text: string) => void }} io
 *   lines: the rest of stdin; write: to stderr
 */
export function stdinGate(token, { lines, write }) {
  let holding = false;
  return {
    async acquire() {
      write(`BROWSER? ${token}\n`);
      for (;;) {
        const line = await lines.next();
        if (line === null) throw new Error('the server stopped answering before the browser check could start');
        if (line === `BROWSER! ${token}`) break;
      }
      holding = true;
    },
    release() {
      if (!holding) return;
      holding = false;
      write(`BROWSER done ${token}\n`);
    },
  };
}

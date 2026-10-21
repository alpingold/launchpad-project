// Is Purdue GenAI Studio up (plan §53)? Every game is designed, built and reviewed there, so
// when it's down, making or changing a game can't work: the pages say so instead of letting
// people start a job that will fail. The server asks once a minute (any answer at all is "up";
// no answer within the timeout, a network error or a 5xx is "down"), so a page load never asks
// Purdue itself.

/**
 * @param {{ url: string, intervalMs: number, timeoutMs: number, fetchImpl?: typeof fetch, now?: () => number,
 *   log?: (message: string) => void }} opts
 */
export function createGenaiStatus({ url, intervalMs, timeoutMs, fetchImpl = fetch, now = Date.now, log = (m) => console.log(m) }) {
  /** @type {{ up: boolean | null, checkedAt: number | null, since: number | null }} up null: not checked yet */
  let state = { up: null, checkedAt: null, since: null };
  let timer = null;

  async function check() {
    let up;
    try {
      const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      up = res.status < 500;
    } catch {
      up = false;
    }
    const at = now();
    if (up !== state.up) {
      if (state.up !== null) log(`[genai] GenAI Studio is ${up ? 'back up' : 'down'}`);
      state = { up, checkedAt: at, since: at };
    } else {
      state = { ...state, checkedAt: at };
    }
    return state;
  }

  return {
    check,
    /** Checks now, then every intervalMs. */
    start() {
      check();
      timer = setInterval(check, intervalMs);
      timer.unref?.(); // never keeps the process alive on its own
    },
    stop() {
      clearInterval(timer);
    },
    /** The last answer: { up: true | false | null (not checked yet), checkedAt, since } (ms). */
    status: () => state,
  };
}

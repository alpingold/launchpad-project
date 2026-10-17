// The browser slot (plan §28): generation jobs take turns for their headless-browser checks.
//
// Jobs talk to the AI in parallel, which costs little, but each browser check needs ~450 MB
// and the CPU for ~20 s, and the checker measures timing, so two at once on a small server
// could fail a good game. The slot lets `size` checks run at once (1 by default); the others
// wait in line, first come, first served. sandbox.js connects it to each job's pipes
// (generator/src/browserGate.js is the job's side).
//
// A job can't keep the slot forever: it's freed when the job ends for any reason (cancel),
// and after `maxHoldMs` the server takes it back and calls the job's onTimeout.

export class BrowserSlot {
  /**
   * @param {{ size?: number, maxHoldMs?: number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} [opts]
   *   setTimer/clearTimer: tests pass fakes
   */
  constructor({ size = 1, maxHoldMs = 120_000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.size = Math.max(1, size);
    this.maxHoldMs = maxHoldMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    /** @type {Map<string, ReturnType<typeof setTimeout>>} jobs holding the slot, and their hold timers */
    this.holders = new Map();
    /** @type {{ id: string, grant: () => void, onTimeout: () => void }[]} jobs waiting, in order */
    this.waiting = [];
  }

  /**
   * Asks for the slot. Resolves when this job has it. A job that already holds it or waits
   * for it can't ask again (its earlier request stands).
   * @param {string} id  the job
   * @param {{ onTimeout?: () => void }} [opts]  called if the job holds it longer than maxHoldMs
   * @returns {Promise<void>}
   */
  request(id, { onTimeout = () => {} } = {}) {
    if (this.holders.has(id) || this.waiting.some((w) => w.id === id)) return Promise.reject(new Error('already asked'));
    return new Promise((grant) => {
      this.waiting.push({ id, grant, onTimeout });
      this.pass();
    });
  }

  /** The job finished its check: the next one in line may go. Ignored if it doesn't hold the slot. */
  release(id) {
    const timer = this.holders.get(id);
    if (timer === undefined) return;
    this.clearTimer(timer);
    this.holders.delete(id);
    this.pass();
  }

  /** The job ended (finished, failed, killed): out of the line, and the slot back if it had it. */
  cancel(id) {
    this.waiting = this.waiting.filter((w) => w.id !== id);
    this.release(id);
  }

  /** 0: holds the slot; 1, 2, …: place in line; null: neither. */
  positionOf(id) {
    if (this.holders.has(id)) return 0;
    const at = this.waiting.findIndex((w) => w.id === id);
    return at === -1 ? null : at + 1;
  }

  /** Gives free places to the jobs at the front of the line. */
  pass() {
    while (this.holders.size < this.size && this.waiting.length > 0) {
      const { id, grant, onTimeout } = this.waiting.shift();
      const timer = this.setTimer(() => {
        if (!this.holders.has(id)) return;
        this.holders.delete(id);
        onTimeout();
        this.pass();
      }, this.maxHoldMs);
      timer?.unref?.(); // a hold timer alone never keeps the process alive (a stopping server, tests)
      this.holders.set(id, timer);
      grant();
    }
  }
}

/**
 * A WebSocket to the server that reconnects on its own, waiting a little longer each time, and
 * checks every message it gets against the protocol's schema before handing it on. Both pages use
 * it: the Screen with `serverToScreen`, a phone with `serverToPhone`.
 *
 * Each time it opens, it sends the message `hello()` gives (openRoom, resumeRoom, join or rejoin):
 * a reconnect is just the first message again. A page stops it for good when the server says the
 * socket's part is over (the Room closed, the Seat taken up elsewhere...).
 */
/** What the protocol's schemas offer: enough to check a message. */
export interface Schema<T> {
  safeParse(value: unknown): { readonly success: true; readonly data: T } | { readonly success: false };
}

/** Waits between tries: 0.5 s, then doubling up to 8 s. */
const FIRST_WAIT_MS = 500;
const LONGEST_WAIT_MS = 8_000;

export interface ConnectionOptions<Incoming> {
  /** The schema every incoming message must pass. One that doesn't is dropped. */
  readonly schema: Schema<Incoming>;
  /** The first message, on every (re)connect. Undefined: send nothing yet. */
  readonly hello: () => unknown;
  readonly onMessage: (message: Incoming) => void;
  /** The socket is open (true) or lost and being retried (false). */
  readonly onStatus: (open: boolean) => void;
}

export class Connection<Incoming> {
  readonly #options: ConnectionOptions<Incoming>;
  #socket: WebSocket | undefined;
  #wait = FIRST_WAIT_MS;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  constructor(options: ConnectionOptions<Incoming>) {
    this.#options = options;
    this.#open();
  }

  send(message: unknown): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message));
  }

  /** Closes the socket and doesn't reconnect. */
  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#retry);
    this.#socket?.close();
  }

  /** Drops the socket and opens a fresh one at once: for starting over with a different first message. */
  restart(): void {
    clearTimeout(this.#retry);
    this.#stopped = false;
    const old = this.#socket;
    this.#socket = undefined;
    old?.close();
    this.#wait = FIRST_WAIT_MS;
    this.#open();
  }

  #open(): void {
    const url = new URL("/ws", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    this.#socket = socket;
    socket.addEventListener("open", () => {
      if (this.#socket !== socket) return;
      this.#wait = FIRST_WAIT_MS;
      this.#options.onStatus(true);
      const hello = this.#options.hello();
      if (hello !== undefined) socket.send(JSON.stringify(hello));
    });
    socket.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (this.#socket !== socket || typeof event.data !== "string") return;
      let value: unknown;
      try {
        value = JSON.parse(event.data);
      } catch {
        return;
      }
      const checked = this.#options.schema.safeParse(value);
      if (checked.success) this.#options.onMessage(checked.data);
    });
    socket.addEventListener("close", () => {
      if (this.#socket !== socket) return;
      this.#socket = undefined;
      this.#options.onStatus(false);
      if (this.#stopped) return;
      this.#retry = setTimeout(() => this.#open(), this.#wait);
      this.#wait = Math.min(LONGEST_WAIT_MS, this.#wait * 2);
    });
  }
}

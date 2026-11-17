/**
 * The Screen's side of the Game frame: owns the hidden iframe, talks to it one message at a time,
 * keeps the Match's real timer, and trusts nothing that comes back.
 *
 * The frame runs the Engine and the Game, so in effect it is the Game: every reply is read with
 * `readFrameReply`, and a frame that answers late, or with something that isn't a valid reply, is
 * the Game failing. The Match is then broken and the iframe removed, which kills its worker.
 */
import { EMPTY_STORAGE_MS, FRAME_REPLY_MS, readFrameReply, type FrameReply, type MatchSnapshot, type Outcome, type ToFrame, type Views } from "@boilergames/sdk/v1/engine";
import type { Player } from "@boilergames/sdk/v1";

/** How long the frame's page has to load before the Screen gives up. Longer than a reply: it comes over the network. */
export const FRAME_LOAD_MS = 15_000;

/** What the Screen learns after each message, and after the timer runs out. */
export type FrameResult =
  | { readonly kind: "result"; readonly outcome: Outcome; readonly views: Views; readonly snapshot: MatchSnapshot }
  /** The Match didn't begin; `why` is the Engine's reason (or the Game's code failed to load). The Screen stays in the Lobby. */
  | { readonly kind: "couldNotStart"; readonly why: string }
  /** The frame stopped answering or answered with nonsense. The Match is over and the frame is gone. */
  | { readonly kind: "failed"; readonly problem: string };

export interface GameFrameOptions {
  /** The frame page on the game domain, such as http://localhost:3001/v1/. */
  readonly frameUrl: string;
  /** Where the hidden iframe goes. */
  readonly container: HTMLElement;
  /** Every result, including the ones the timer causes, in order. */
  readonly onResult: (result: FrameResult) => void;
}

export class GameFrame {
  readonly #options: GameFrameOptions;
  readonly #iframe: HTMLIFrameElement;
  readonly #queue: { readonly message: ToFrame; readonly done: (result: FrameResult) => void }[] = [];
  /** Every Player id sent to the frame. A reply naming anyone else is made up. */
  readonly #known = new Set<string>();
  #ready = false;
  #waiting: { readonly message: ToFrame; readonly done: (result: FrameResult) => void } | undefined;
  #replyTimeout: ReturnType<typeof setTimeout> | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #deadline: number | null = null;
  /** Ended, broken, failed or couldn't start: nothing more is sent. */
  #over = false;
  /** Whether the frame has said `emptied` for the start or resume being waited on. */
  #emptied = false;

  constructor(options: GameFrameOptions) {
    this.#options = options;
    this.#iframe = document.createElement("iframe");
    // Scripts only. Never allow-same-origin: with it, the Game would run as the game domain.
    this.#iframe.setAttribute("sandbox", "allow-scripts");
    this.#iframe.hidden = true;
    this.#iframe.src = options.frameUrl;
    window.addEventListener("message", this.#onMessage);
    options.container.append(this.#iframe);
    this.#replyTimeout = setTimeout(() => this.#fail("the Game frame didn't load"), FRAME_LOAD_MS);
  }

  /** When the timer will run out (`Date.now()` time), or null when it isn't running. Saved with the snapshot. */
  get timerDeadline(): number | null {
    return this.#deadline;
  }

  start(bundle: string, players: readonly Player[], seed: number): Promise<FrameResult> {
    for (const p of players) this.#known.add(p.id);
    return this.#send({ type: "start", bundle, players, seed });
  }

  /**
   * Resumes a saved Match. The snapshot comes from localStorage, so it may be damaged: the Engine
   * checks it and says `couldNotStart` if so. `timerDeadline`, if the timer was running, restarts
   * it (at once if it has passed).
   */
  resume(bundle: string, snapshot: unknown, timerDeadline: number | null): Promise<FrameResult> {
    const players: unknown = typeof snapshot === "object" && snapshot !== null ? (snapshot as { players?: unknown }).players : undefined;
    if (Array.isArray(players)) {
      for (const p of players as unknown[]) {
        const id: unknown = typeof p === "object" && p !== null ? (p as { id?: unknown }).id : undefined;
        if (typeof id === "string") this.#known.add(id);
      }
    }
    const sent = this.#send({ type: "resume", bundle, snapshot });
    void sent.then((result) => {
      if (result.kind === "result" && result.outcome.status === "running" && result.snapshot.timerRunning && timerDeadline !== null) {
        // The saved deadline is kept exactly: turned into "ms left" and back, it would drift by
        // a millisecond whenever the clock ticked in between.
        this.#setDeadline(timerDeadline);
      }
    });
    return sent;
  }

  act(playerId: string, action: unknown): Promise<FrameResult> {
    return this.#send({ type: "act", playerId, action });
  }

  setPlayers(players: readonly Player[]): Promise<FrameResult> {
    for (const p of players) this.#known.add(p.id);
    return this.#send({ type: "setPlayers", players });
  }

  /** Stops everything: the timer, the worker (by removing its iframe), and any answer still to come. */
  destroy(): void {
    this.#over = true;
    this.#clearTimer();
    clearTimeout(this.#replyTimeout);
    window.removeEventListener("message", this.#onMessage);
    this.#iframe.remove();
  }

  #send(message: ToFrame): Promise<FrameResult> {
    if (this.#over) return Promise.resolve({ kind: "failed", problem: "the Match is over" });
    return new Promise((done) => {
      this.#queue.push({ message, done });
      this.#next();
    });
  }

  /** Sends the next message if the frame is ready and isn't busy: one at a time, so replies can't be mismatched. */
  #next(): void {
    if (!this.#ready || this.#waiting !== undefined || this.#over) return;
    const item = this.#queue.shift();
    if (item === undefined) return;
    this.#waiting = item;
    this.#emptied = false;
    // Before a start or resume, the frame first empties its storage, on its own budget; the frame
    // ends that itself after EMPTY_STORAGE_MS, so the Screen waits a little longer than that.
    const starting = item.message.type === "start" || item.message.type === "resume";
    this.#replyTimeout = starting
      ? setTimeout(() => this.#fail("the Game frame stopped responding while getting ready"), EMPTY_STORAGE_MS + FRAME_REPLY_MS)
      : setTimeout(() => this.#fail("the Game stopped responding"), FRAME_REPLY_MS);
    this.#iframe.contentWindow?.postMessage(item.message, "*");
  }

  readonly #onMessage = (event: MessageEvent<unknown>): void => {
    // Only the frame's own window counts; any other page could post anything.
    if (event.source === null || event.source !== this.#iframe.contentWindow || this.#over) return;
    const data = event.data;
    if (!this.#ready) {
      if (typeof data === "object" && data !== null && (data as { type?: unknown }).type === "ready") {
        this.#ready = true;
        clearTimeout(this.#replyTimeout);
        this.#next();
      }
      return;
    }
    const waiting = this.#waiting;
    if (waiting === undefined) return;
    // The storage is empty and the Game is loading: from now on, the Game's own two seconds.
    if (typeof data === "object" && data !== null && (data as { type?: unknown }).type === "emptied") {
      if ((waiting.message.type !== "start" && waiting.message.type !== "resume") || this.#emptied) {
        return this.#fail("the Game frame sent emptied when it shouldn't have", waiting.done);
      }
      this.#emptied = true;
      clearTimeout(this.#replyTimeout);
      this.#replyTimeout = setTimeout(() => this.#fail("the Game stopped responding"), FRAME_REPLY_MS);
      return;
    }
    clearTimeout(this.#replyTimeout);
    this.#waiting = undefined;

    const read = readFrameReply(data, this.#known);
    if (!read.ok) return this.#fail(`the Game frame sent a reply that isn't valid: ${read.problem}`, waiting.done);
    const result = this.#accept(read.reply, waiting.message);
    waiting.done(result);
    this.#options.onResult(result);
    if (this.#over) for (const item of this.#queue.splice(0)) item.done({ kind: "failed", problem: "the Match is over" });
    else this.#next();
  };

  #accept(reply: FrameReply, sent: ToFrame): FrameResult {
    if (reply.type === "couldNotStart") {
      if (sent.type !== "start" && sent.type !== "resume") return this.#failed(`the Game frame said it couldn't start, in reply to ${sent.type}`);
      this.destroy();
      return { kind: "couldNotStart", why: reply.why };
    }
    const outcome = reply.outcome;
    if (outcome.status === "running") {
      if (outcome.timer === null) this.#clearTimer();
      else if (outcome.timer !== undefined) this.#setTimer(outcome.timer);
    }
    // Over: the frame has nothing more to do, and removing it stops its worker.
    if (outcome.status === "ended" || outcome.status === "broken") this.destroy();
    return { kind: "result", outcome, views: reply.views, snapshot: reply.snapshot };
  }

  #setTimer(ms: number): void {
    this.#setDeadline(Date.now() + ms);
  }

  /** Runs the timer until `deadline` (`Date.now()` time), at once if it has passed. */
  #setDeadline(deadline: number): void {
    this.#clearTimer();
    this.#deadline = deadline;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#deadline = null;
      void this.#send({ type: "timerFired" });
    }, Math.max(0, deadline - Date.now()));
  }

  #clearTimer(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#deadline = null;
  }

  /** The frame failed: tell whoever waits, and every listener, then tear it down. */
  #fail(problem: string, done?: (result: FrameResult) => void): void {
    if (this.#over) return;
    const result = this.#failed(problem);
    (done ?? this.#waiting?.done)?.(result);
    for (const item of this.#queue.splice(0)) item.done(result);
    this.#options.onResult(result);
  }

  #failed(problem: string): FrameResult {
    this.destroy();
    return { kind: "failed", problem };
  }
}

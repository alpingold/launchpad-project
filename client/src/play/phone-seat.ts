/**
 * A phone's side of a Room, without React: the socket, its Seat (kept in localStorage so a reload
 * keeps it), and its latest View, checked with the SDK's checker before anything draws it.
 */
import { serverToPhone, type Room, type ServerToPhone } from "@boilergames/protocol";
import type { ControllerView } from "@boilergames/sdk/v1";
import { checkControllerView } from "@boilergames/sdk/v1/check";
import { Connection } from "../net/connection.js";
import { forget, load, save } from "../net/saved.js";

interface Saved {
  readonly code: string;
  readonly seatToken: string;
}

const SAVED = "boilergames.phone";

export interface PhoneState {
  /** form: not in a Room; joining; seated; gone: this page's Seat is over and it won't reconnect. */
  readonly phase: "form" | "joining" | "seated" | "gone";
  readonly room: Room | null;
  readonly seatId: string | null;
  /** This Seat's latest View during a Match, checked. Null in the Lobby, or for a latecomer. */
  readonly view: ControllerView<unknown> | null;
  readonly timerEndsAt: number | null;
  readonly online: boolean;
  /** Something to tell the Player: why joining failed, or why the Seat ended. */
  readonly notice: string | null;
}

export class PhoneSeat {
  state: PhoneState = { phase: "form", room: null, seatId: null, view: null, timerEndsAt: null, online: false, notice: null };
  readonly #listeners = new Set<() => void>();
  #saved: Saved | undefined = load<Saved>(SAVED);
  #joining: { code: string; name: string } | undefined;
  #connection: Connection<ServerToPhone> | undefined;
  #wakeLock: { release(): Promise<void> } | undefined;

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** On load: take the saved Seat back, if there is one. */
  begin(): void {
    if (this.#saved !== undefined) this.#connect();
  }

  join(code: string, name: string): void {
    this.#joining = { code: code.trim().toUpperCase(), name };
    this.#connect();
  }

  act(action: unknown): void {
    this.#connection?.send({ type: "action", action });
  }

  leave(): void {
    this.#connection?.send({ type: "leave" });
  }

  #connect(): void {
    this.#set({ phase: "joining", notice: null });
    if (this.#connection !== undefined) return this.#connection.restart();
    this.#connection = new Connection({
      schema: serverToPhone,
      hello: () =>
        this.#saved !== undefined
          ? { type: "rejoin", v: 1, code: this.#saved.code, seatToken: this.#saved.seatToken }
          : this.#joining !== undefined
            ? { type: "join", v: 1, code: this.#joining.code, name: this.#joining.name }
            : undefined,
      onMessage: (message) => this.#receive(message),
      onStatus: (online) => this.#set({ online }),
    });
  }

  #receive(message: ServerToPhone): void {
    switch (message.type) {
      case "seated":
        this.#saved = { code: message.room.code, seatToken: message.seatToken };
        this.#joining = undefined;
        save(SAVED, this.#saved);
        return this.#room(message.room, { phase: "seated", seatId: message.seatId });
      case "room":
        return this.#room(message.room, {});
      case "view": {
        // A View from the Screen is a Game's data: checked before it is drawn, like any Game's.
        const checked = checkControllerView(message.view);
        if (!checked.ok) return;
        return this.#set({ view: checked.view, notice: null, timerEndsAt: message.timerMs === null ? null : Date.now() + message.timerMs });
      }
      case "refused":
        return this.#refused(message.reason);
      case "closed":
        return this.#closed(message.reason);
    }
  }

  #room(room: Room, change: Partial<PhoneState>): void {
    // Back in the Lobby: the last Match's View is gone.
    const view = room.match === null ? null : this.state.view;
    this.#set({ ...change, room, view, ...(room.match === null ? { timerEndsAt: null } : {}) });
    void this.#keepAwake(room.match !== null);
  }

  #refused(reason: Extract<ServerToPhone, { type: "refused" }>["reason"]): void {
    // Too fast: the server keeps the Seat (and if it closed the socket, the page comes back with
    // rejoin). Only a refusal that means the Seat is gone, or was never had, ends it.
    if (reason === "tooFast" && this.#saved !== undefined) {
      return this.#set({ notice: "Slow down: that was too much at once. Your Seat is kept." });
    }
    if (reason === "badMessage" && this.state.phase === "seated") {
      return this.#set({ notice: "The server didn't understand something this phone sent." });
    }
    const words: Record<typeof reason, string> = {
      noSuchRoom: "There's no Room with that code. Check the code on the Screen.",
      badToken: "Your Seat in that Room is gone. Join again.",
      roomFull: "That Room is full.",
      tooFast: "Too many tries from here. Wait a minute and try again.",
      badMessage: "The server didn't understand this phone. Reload the page and try again.",
      oldPage: "This page is out of date. Reload it.",
      tooManyRooms: "The site is full right now. Try again in a few minutes.",
      tooManyRoomsHere: "Too many Rooms are open from this network.",
    };
    this.#stopAndForget();
    this.#set({ phase: "form", notice: words[reason], room: null, seatId: null, view: null });
  }

  #closed(reason: Extract<ServerToPhone, { type: "closed" }>["reason"]): void {
    if (reason === "replaced") {
      // Another tab has the Seat now. Reconnecting would take it back, and the two would trade it forever.
      this.#connection?.stop();
      return this.#set({ phase: "gone", notice: "Your Seat is open in another tab or on another device.", view: null });
    }
    const words = {
      left: "You left the Room.",
      removed: "The Host removed you from the Room.",
      hostClosed: "The Host closed the Room.",
      screenGone: "The Room closed: the Screen was away too long.",
    } as const;
    this.#stopAndForget();
    this.#set({ phase: "form", notice: words[reason], room: null, seatId: null, view: null });
  }

  #stopAndForget(): void {
    this.#connection?.stop();
    this.#connection = undefined;
    this.#saved = undefined;
    forget(SAVED);
    void this.#keepAwake(false);
  }

  /** During a Match, asks the phone not to dim its screen. Not every browser can; nothing breaks if not. */
  async #keepAwake(on: boolean): Promise<void> {
    try {
      if (on && this.#wakeLock === undefined) {
        const wake = (navigator as { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
        this.#wakeLock = await wake?.request("screen");
      } else if (!on && this.#wakeLock !== undefined) {
        const lock = this.#wakeLock;
        this.#wakeLock = undefined;
        await lock.release();
      }
    } catch {
      // Refused (the page is hidden, or the browser doesn't allow it): the phone may dim, that's all.
    }
  }

  #set(change: Partial<PhoneState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.#listeners) listener();
  }
}

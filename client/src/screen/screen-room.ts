/**
 * The Screen's side of a Room, without React: the socket to the server, the Game frame, and what is
 * saved in localStorage so a reload carries on. The Screen page draws whatever `state` says.
 *
 * The Screen is the referee: it runs the Game in the frame, and after every result it draws the
 * Screen's View, sends each phone its own View (only those that changed), and saves the Match.
 */
import { serverToScreen, type Room, type ServerToScreen } from "@boilergames/protocol";
import type { Look, Player, ScreenView } from "@boilergames/sdk/v1";
import { Connection } from "../net/connection.js";
import { packViews } from "../net/pack-views.js";
import { forget, load, save } from "../net/saved.js";
import { GameFrame, type FrameResult } from "./game-frame.js";

/**
 * One line of /api/games: an Official game by its name, or an uploaded Game by its Version's id. A
 * Match is of one Version, so it keeps the code it started with, even after a reload.
 */
export interface GameListing {
  readonly id: string;
  readonly title: string;
  readonly players: { readonly min: number; readonly max: number };
  readonly look?: Look;
  /** An uploaded Game's Creator, by display name. */
  readonly creator?: string;
  /** Uploaded by a Creator, not one of the site's own: the Lobby says so. */
  readonly uploaded?: true;
}

interface Saved {
  readonly code: string;
  readonly hostToken: string;
  /**
   * The Match being played. `game` is kept with it: after a reload the list may no longer name its
   * Version (a newer one published, or one only its Creator can play).
   */
  readonly match?: { readonly gameId: string; readonly game?: GameListing; readonly snapshot: unknown; readonly timerDeadline: number | null };
}

/** What the Screen says when a Game's code is refused: only its Creator may load an unpublished Version. */
export const CODE_REFUSED = "This Game's code can't be loaded: it has been unpublished, or it's an unpublished Version and only its Creator, signed in on this browser, can play it.";

const SAVED = "boilergames.screen";

export interface ScreenState {
  /** connecting: no Room yet; lobby; match: a Match is on; gone: the Room is over for this page. */
  readonly phase: "connecting" | "lobby" | "match" | "gone";
  readonly room: Room | null;
  /** The socket is open. */
  readonly online: boolean;
  readonly games: readonly GameListing[];
  /** A Version its Creator is trying out (Play it, on the Creator's page): offered above the list. */
  readonly trying: GameListing | null;
  /** Something to tell the Host, such as why a Game couldn't start. */
  readonly notice: string | null;
  /** Why this page's Room is over, when phase is gone. */
  readonly gone: string | null;
  readonly match: { readonly title: string; readonly look: Look | undefined; readonly view: ScreenView | null; readonly timerEndsAt: number | null } | null;
}

export class ScreenRoom {
  state: ScreenState = { phase: "connecting", room: null, online: false, games: [], trying: null, notice: null, gone: null, match: null };
  readonly #listeners = new Set<() => void>();
  readonly #frameContainer: HTMLElement;
  #frameUrl = "";
  #connection: Connection<ServerToScreen> | undefined;
  #saved: Saved | undefined = load<Saved>(SAVED);
  #frame: GameFrame | undefined;
  /** The Game the frame is playing. */
  #game: GameListing | undefined;
  /** The Version to try out, from the address (/screen?play=<id>). */
  readonly #play: string | null;
  /** Whether the server has been told about the Match running in the frame. */
  #announced = false;
  /** The Views each phone was last sent, as JSON, and the timer deadline they carried. */
  #sent = new Map<string, string>();
  #sentDeadline: number | null = null;
  /** The Player ids the frame was last given. */
  #players = "";
  /** Each phone's latest View, to send again after the Screen's socket comes back. */
  #latestViews: Readonly<Record<string, unknown>> = {};
  /** How the last Match ended, to send again if the socket was down when it did. */
  #lastEnd: EndMatch | undefined;

  constructor(frameContainer: HTMLElement, options: { readonly play?: string | null } = {}) {
    this.#frameContainer = frameContainer;
    this.#play = options.play ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Learns where the frame and the Games are, then opens (or takes back) the Room. */
  async begin(): Promise<void> {
    const [config, games] = await Promise.all([fetch("/api/config").then((r) => r.json()), fetch("/api/games").then((r) => r.json())]);
    this.#frameUrl = (config as { frameUrl: string }).frameUrl;
    this.#set({ games: games as GameListing[] });
    if (this.#play !== null) {
      const response = await fetch(`/api/games/${encodeURIComponent(this.#play)}`);
      if (response.ok) this.#set({ trying: (await response.json()) as GameListing });
      else this.#set({ notice: CODE_REFUSED });
    }
    this.#connection = new Connection({
      schema: serverToScreen,
      hello: () => (this.#saved === undefined ? { type: "openRoom", v: 1 } : { type: "resumeRoom", v: 1, code: this.#saved.code, hostToken: this.#saved.hostToken }),
      onMessage: (message) => this.#receive(message),
      onStatus: (online) => this.#set({ online }),
    });
  }

  /** Starts a Match of `gameId` with everyone in the Room. */
  async startMatch(gameId: string): Promise<void> {
    const game = [...(this.state.trying === null ? [] : [this.state.trying]), ...this.state.games].find((g) => g.id === gameId);
    const room = this.state.room;
    if (game === undefined || room === null || this.#frame !== undefined) return;
    this.#set({ notice: null });
    const bundle = await codeOf(gameId);
    if (bundle === undefined) return this.#set({ notice: CODE_REFUSED });
    if (this.#frame !== undefined) return;
    this.#game = game;
    this.#announced = false;
    this.#frame = this.#newFrame();
    this.#players = room.seats.map((s) => s.id).join(",");
    await this.#frame.start(bundle, room.seats.map(toPlayer), Math.floor(Math.random() * 2 ** 31));
  }

  /** The Host stops the Match. */
  stopMatch(): void {
    if (this.#frame === undefined) return;
    this.#endMatch({ type: "endMatch", reason: "stopped" });
  }

  removeSeat(seatId: string): void {
    this.#connection?.send({ type: "removeSeat", seatId });
  }

  /** Starts over with a new Room, after this one is gone. */
  openNewRoom(): void {
    forget(SAVED);
    this.#saved = undefined;
    this.#set({ phase: "connecting", room: null, gone: null, notice: null, match: null });
    this.#connection?.restart();
  }

  // -------------------------------------------------------------------------------------------

  #receive(message: ServerToScreen): void {
    switch (message.type) {
      case "roomOpened": {
        this.#saved = { ...this.#saved, code: message.room.code, hostToken: message.hostToken };
        save(SAVED, this.#saved);
        this.#set({ room: message.room, phase: this.#frame === undefined ? "lobby" : "match" });
        if (this.#frame !== undefined) return this.#catchUp(message.room);
        // Back after a reload, with a Match the server still has: carry on with it.
        if (this.#saved.match !== undefined) {
          if (message.room.match !== null) void this.#resumeMatch(this.#saved.match);
          else this.#forgetMatch();
        } else if (message.room.match !== null) {
          // The server still has a Match this Screen ended while its socket was down.
          this.#connection?.send(this.#lastEnd ?? { type: "endMatch", reason: "broken" });
        }
        return;
      }
      case "room":
        this.#set({ room: message.room });
        this.#tellFramePlayers(message.room);
        return;
      case "action":
        void this.#frame?.act(message.seatId, message.action);
        return;
      case "refused":
        return this.#refused(message.reason);
      case "closed":
        return this.#closed(message.reason);
    }
  }

  #refused(reason: Extract<ServerToScreen, { type: "refused" }>["reason"]): void {
    switch (reason) {
      case "noSuchRoom":
      case "badToken":
        // The saved Room is gone (or was never ours): open a new one.
        forget(SAVED);
        this.#saved = undefined;
        this.#connection?.restart();
        return;
      case "tooManyRooms":
        this.#connection?.stop();
        return this.#set({ phase: "gone", gone: "The site has as many Rooms open as it can hold right now. Try again in a few minutes." });
      case "tooManyRoomsHere":
        this.#connection?.stop();
        return this.#set({ phase: "gone", gone: "This network already has as many Rooms open as it may. Close one on its Screen, or wait a minute for an empty one to close." });
      case "oldPage":
        this.#connection?.stop();
        return this.#set({ phase: "gone", gone: "This page is out of date. Reload it." });
      case "tooFast":
        return this.#set({ notice: "Slow down: the Screen sent too much at once." });
      default:
        return this.#set({ notice: "The server didn't understand something the Screen sent." });
    }
  }

  #closed(reason: Extract<ServerToScreen, { type: "closed" }>["reason"]): void {
    this.#connection?.stop();
    this.#frame?.destroy();
    this.#frame = undefined;
    if (reason === "replaced") {
      // Not forgotten: the other tab has this Room now, and this one must not take it back.
      return this.#set({ phase: "gone", gone: "This Room is open in another tab or on another device." });
    }
    forget(SAVED);
    this.#saved = undefined;
    const why = reason === "hostClosed" ? "You closed the Room." : "The Room closed while the Screen was away.";
    this.#set({ phase: "gone", gone: why, match: null });
  }

  /**
   * The socket came back while a Match runs in the frame: anything sent while it was down was lost.
   * Announce the Match again if the server doesn't have it, send every phone its latest View, and
   * give the frame the Room's Seats (some may have come or gone meanwhile).
   */
  #catchUp(room: Room): void {
    if (!this.#announced) return;
    if (room.match === null) this.#announce();
    this.#sent.clear();
    this.#sentDeadline = null;
    this.#sendViews(this.#latestViews, this.#frame?.timerDeadline ?? null, true);
    this.#tellFramePlayers(room);
  }

  #announce(): void {
    const game = this.#game;
    if (game === undefined) return;
    this.#connection?.send({ type: "startMatch", match: { gameId: game.id, title: game.title, look: game.look ?? {} } });
  }

  #newFrame(): GameFrame {
    return new GameFrame({ frameUrl: this.#frameUrl, container: this.#frameContainer, onResult: (result) => this.#result(result) });
  }

  async #resumeMatch(match: NonNullable<Saved["match"]>): Promise<void> {
    // Saved before the Game was kept with the Match: the list, if it still names it.
    const game = match.game ?? this.state.games.find((g) => g.id === match.gameId) ?? { id: match.gameId, title: "The Game", players: { min: 1, max: 16 } };
    this.#game = game;
    this.#announced = true;
    const bundle = await codeOf(match.gameId);
    if (bundle === undefined) {
      // Its code is refused now (taken down, or the Creator signed out): the Match can't go on.
      this.#endMatch({ type: "endMatch", reason: "broken" });
      return this.#set({ notice: CODE_REFUSED });
    }
    this.#sent.clear();
    this.#sentDeadline = null;
    const players = (match.snapshot as { players?: { id: string }[] } | null)?.players ?? [];
    this.#players = players.map((p) => p.id).join(",");
    this.#frame = this.#newFrame();
    this.#set({ phase: "match" });
    await this.#frame.resume(bundle, match.snapshot, match.timerDeadline);
    // Seats may have come or gone while the Screen was away.
    if (this.state.room !== null) this.#tellFramePlayers(this.state.room);
  }

  /** Gives the frame the Room's Seats, connected or not, when they changed: a Seat that is gone has left. */
  #tellFramePlayers(room: Room): void {
    const ids = room.seats.map((s) => s.id).join(",");
    if (this.#frame === undefined || ids === this.#players) return;
    this.#players = ids;
    void this.#frame.setPlayers(room.seats.map(toPlayer));
  }

  #result(result: FrameResult): void {
    if (result.kind === "couldNotStart") {
      this.#frame = undefined;
      if (this.#announced) this.#endMatch({ type: "endMatch", reason: "broken" });
      return this.#set({ notice: `The Game couldn't start: ${result.why}`, phase: "lobby", match: null });
    }
    if (result.kind === "failed") {
      this.#endMatch({ type: "endMatch", reason: "broken" });
      return this.#set({ notice: `The Game stopped: ${result.problem}` });
    }
    const game = this.#game;
    if (!this.#announced) {
      this.#announced = true;
      this.#sent.clear();
      this.#sentDeadline = null;
      this.#announce();
    }
    const outcome = result.outcome;
    if (outcome.status === "ended") {
      return this.#endMatch({ type: "endMatch", reason: outcome.reason, ...outcome.end });
    }
    if (outcome.status === "broken") {
      this.#endMatch({ type: "endMatch", reason: "broken" });
      return this.#set({ notice: `The Game broke: ${outcome.problem}` });
    }
    const deadline = this.#frame?.timerDeadline ?? null;
    this.#set({ phase: "match", match: { title: game?.title ?? "", look: game?.look, view: result.views.screen, timerEndsAt: deadline } });
    if (outcome.status === "ignored") return;
    this.#latestViews = result.views.controllers;
    this.#sendViews(result.views.controllers, deadline);
    this.#saved = { ...this.#saved!, match: { gameId: game?.id ?? "", ...(game === undefined ? {} : { game }), snapshot: result.snapshot, timerDeadline: deadline } };
    save(SAVED, this.#saved);
  }

  /** Sends each phone whose View changed its new View, in as few messages as fit; and the timer if it changed. */
  #sendViews(views: Readonly<Record<string, unknown>>, deadline: number | null, always = false): void {
    const changed = new Map<string, unknown>();
    for (const [seatId, view] of Object.entries(views)) {
      const text = JSON.stringify(view);
      if (this.#sent.get(seatId) === text) continue;
      this.#sent.set(seatId, text);
      changed.set(seatId, view);
    }
    if (!always && changed.size === 0 && deadline === this.#sentDeadline) return;
    this.#sentDeadline = deadline;
    const timerMs = deadline === null ? null : Math.max(0, deadline - Date.now());
    for (const message of packViews(changed, timerMs)) this.#connection?.send(message);
  }

  #endMatch(message: EndMatch): void {
    this.#lastEnd = message;
    this.#latestViews = {};
    this.#connection?.send(message);
    this.#frame?.destroy();
    this.#frame = undefined;
    this.#forgetMatch();
    this.#set({ phase: "lobby", match: null });
  }

  #forgetMatch(): void {
    if (this.#saved === undefined) return;
    const { match: _match, ...rest } = this.#saved;
    this.#saved = rest;
    save(SAVED, this.#saved);
  }

  #set(change: Partial<ScreenState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.#listeners) listener();
  }
}

const toPlayer = (seat: Room["seats"][number]): Player => ({ id: seat.id, name: seat.name });

/**
 * A Game's code, or undefined if the site refuses it. An unpublished Version's code goes only to its
 * Creator: the browser sends the session cookie with this request, as with any to the site itself.
 */
async function codeOf(gameId: string): Promise<string | undefined> {
  try {
    const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/bundle.js`);
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  }
}

type EndMatch = { type: "endMatch"; reason: "finished" | "stopped" | "broken" | "tooFewPlayers"; scores?: Readonly<Record<string, number>>; winners?: readonly string[] };

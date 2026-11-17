/**
 * The simulator: plays a Game to its end with made-up Players, to find Games that crash, get stuck
 * or never finish. It is the test harness for Official games now and the heart of the Playtest
 * later, so its problems are written for whoever has to fix the Game, a person or the AI.
 *
 * It drives the real Engine, so a Game that passes here passes for the same reasons in a real Room.
 * Its own choices (who acts, what they type, when the timer runs out) come from a second seeded
 * generator, so the same seed always gives the same run.
 *
 * It cannot stop a Game that loops forever inside one of its functions: whoever runs it does (the
 * Game frame's two-second rule, or the Playtest's child process with a time limit).
 */
import type { Drawing, Hex, Player } from "./index.js";
import { MAX_PLAYERS, startMatch, type AnyGame, type Match, type Outcome } from "./engine.js";
import { availableActions, type AvailableAction } from "./offers.js";
import { createRng, type SeededRng } from "./rng.js";

/** How many events a Match may take before the simulator calls it endless. */
export const MAX_SIMULATED_EVENTS = 5_000;
/** On each event, the chance the simulated clock runs the timer out even though someone could act. */
const TIMER_CHANCE = 1 / 20;
/**
 * Leavers leave at random moments within the first this-many-times-their-number events. Early, and
 * the simulated clock leaves the timer alone until everyone has come and gone, so a short Match
 * still sees every one of them; only a Game that ends sooner on its own can cut one short.
 */
const WINDOW_PER_LEAVER = 2;
/**
 * Joiners arrive at random moments within the first this-much of the Match, measured by playing it
 * once without them. Measured, not guessed from the number of joiners: a window that ignores the
 * Match's length lands joiners in its last round, where a Game that seats newcomers at the next
 * round has nothing left to give them, and the run would blame the Game for the simulator's timing.
 */
const JOIN_WITHIN = 1 / 3;

export interface SimulateOptions {
  /** How many Players start the Match. */
  readonly players: number;
  /** Seeds the Match and, separately, the simulator's own choices. */
  readonly seed: number;
  /** How many of them leave, at random moments early in the Match. */
  readonly leavers?: number;
  /**
   * How many more Players arrive, at random moments in the first third of the Match. A Game with
   * `onJoin` takes them in while it has room, and from then on they must be offered something like
   * anyone else; a Game without `onJoin`, or one that is full, leaves them waiting for the next
   * Match, which is no problem. A waiting one joins if a Player leaves later and makes room.
   *
   * To know how long the Match is, the simulator first plays it once without joiners (the same seed,
   * so the same Match). If that run already has problems, those are what it reports, and the run
   * with joiners is skipped: its problems would only repeat them.
   */
  readonly joiners?: number;
}

export interface SimulateResult {
  /** True when the Match ended properly and there were no problems. */
  readonly ok: boolean;
  /** Every problem found in the run, each saying what to fix. */
  readonly problems: string[];
  /** How many events the Match took: Actions, timers running out and Players leaving. */
  readonly steps: number;
}

export function simulate(game: AnyGame, options: SimulateOptions): SimulateResult {
  const leavers = options.leavers ?? 0;
  const joiners = options.joiners ?? 0;
  if (!Number.isInteger(options.players) || options.players < 1) return refused("players must be a whole number of at least 1");
  if (!Number.isInteger(leavers) || leavers < 0 || leavers >= options.players) return refused("leavers must be a whole number from 0 to one fewer than players");
  // Everyone, joiners included, is a Seat in the same Room, and a Room holds at most 16.
  if (!Number.isInteger(joiners) || joiners < 0 || options.players + joiners > MAX_PLAYERS) {
    return refused(`joiners must be a whole number from 0 to ${MAX_PLAYERS} minus players`);
  }

  const player = (i: number): Player => ({ id: `p${i + 1}`, name: `Player ${i + 1}` });
  const starters = Array.from({ length: options.players }, (_, i) => player(i));
  const latecomers = Array.from({ length: joiners }, (_, i) => player(options.players + i));
  const play = (joins: readonly Join[]): SimulateResult => {
    const begun = startMatch(game, { players: starters, seed: options.seed });
    if (!begun.ok) return refused(`the Match couldn't start with ${options.players} Players: ${begun.why}`);
    // The simulator's own generator: a different seed from the Match's, so its choices don't shift
    // the Game's own random numbers.
    const choices = createRng((options.seed ^ 0x5f3759df) >>> 0);
    return new Run(begun.match, starters, leavers, joins, choices).play(begun.outcome);
  };

  const measured = play([]);
  if (latecomers.length === 0 || !measured.ok) return measured;

  // Join times come from a third generator, so the run with joiners is the measured run, event for
  // event, until the first joiner arrives.
  const joinTimes = createRng((options.seed ^ 0x2545f491) >>> 0);
  const window = Math.max(1, Math.floor(measured.steps * JOIN_WITHIN));
  return play(latecomers.map((who) => ({ at: joinTimes.int(0, window - 1), who })));
}

/** A Player who arrives after the start, and the number of events before they do. */
interface Join {
  readonly at: number;
  readonly who: Player;
}

/** "1 event", "5 events". */
function events(n: number): string {
  return n === 1 ? "1 event" : `${n} events`;
}

function refused(problem: string): SimulateResult {
  return { ok: false, problems: [problem], steps: 0 };
}

class Run {
  /** A Set, so a problem that happens on every event is listed once. */
  private readonly problems = new Set<string>();
  /** Everyone in the Room: the Players in the Match, and joiners still waiting to get in. */
  private present: Player[];
  private readonly offered = new Set<string>();
  /** Players leave and joiners arrive at these event numbers, soonest first. */
  private comings: { readonly at: number; readonly who: "leaver" | Player }[];
  /** How many events had happened when each joiner got into the Match, for the problem text. */
  private readonly joinedAfter = new Map<string, number>();
  private readonly latecomerIds: ReadonlySet<string>;
  private steps = 0;

  constructor(
    private readonly match: Match,
    starters: readonly Player[],
    leavers: number,
    joins: readonly Join[],
    private readonly rng: SeededRng,
  ) {
    this.present = [...starters];
    this.latecomerIds = new Set(joins.map((j) => j.who.id));
    const window = WINDOW_PER_LEAVER * leavers;
    const leaves = Array.from({ length: leavers }, () => ({ at: rng.int(0, window - 1), who: "leaver" as const }));
    // Stable sort, leaves first: a leave and a join on the same event happen in that order.
    this.comings = [...leaves, ...joins].sort((a, b) => a.at - b.at);
  }

  play(first: Outcome): SimulateResult {
    let outcome = first;
    let finished = false;
    for (;;) {
      if (outcome.status === "broken") {
        // Cut short, like a Match ended by too few Players: whether everyone would have had a turn
        // can't be known, so the "never offered" check would only add noise to the real problem.
        this.problems.add(`the Match broke after ${events(this.steps)}: ${outcome.problem}`);
        return this.result(false);
      }
      if (outcome.status === "ended") {
        finished = true;
        // Ended because Players left: whoever is still here may not have had their turn yet.
        if (outcome.reason === "tooFewPlayers") return this.result(finished);
        break;
      }
      if (this.steps >= MAX_SIMULATED_EVENTS) {
        this.problems.add(
          `the Match didn't end within ${MAX_SIMULATED_EVENTS.toLocaleString("en-US")} events. Make sure it always ends: after a number of rounds, or when the timer runs out`,
        );
        break;
      }
      let next: Outcome | "stuck";
      try {
        next = this.nextEvent();
      } catch (error) {
        // The Engine is built never to throw; if it does, say so rather than crash the run.
        this.problems.add(`the Engine itself failed after ${events(this.steps)} (a bug in the site, not the Game): ${String(error)}`);
        break;
      }
      if (next === "stuck") {
        this.problems.add(
          `the Match got stuck after ${events(this.steps)}: no Player has anything to do and no timer is running. Give someone an Action, or start the timer`,
        );
        break;
      }
      this.steps += 1;
      outcome = next;
    }
    this.checkEveryoneWasOffered();
    return this.result(finished);
  }

  private result(finished: boolean): SimulateResult {
    return { ok: finished && this.problems.size === 0, problems: [...this.problems], steps: this.steps };
  }

  /** Makes one thing happen: a Player leaves, the timer runs out, or a Player acts. */
  private nextEvent(): Outcome | "stuck" {
    // Look at every Controller first, so a Player who could act now counts as offered even if the
    // next event is someone leaving.
    const views = this.match.views().controllers;
    const able: { player: Player; offers: AvailableAction[] }[] = [];
    for (const player of this.present) {
      const view = views[player.id];
      const offers = view === undefined ? [] : availableActions(view);
      if (offers.length > 0) {
        able.push({ player, offers });
        this.offered.add(player.id);
      }
    }

    // Every joiner who is due arrives now, together, as one event: one at a time, they could queue
    // up behind each other and land later than their moment, past the first third of the Match.
    const due = this.comings.filter((c) => c.at <= this.steps);
    const arriving = due.flatMap((c) => (c.who === "leaver" ? [] : [c.who]));
    if (arriving.length > 0) {
      this.comings = this.comings.filter((c) => c.who === "leaver" || !arriving.includes(c.who));
      return this.join(arriving);
    }
    // Leavers go one per event, as before joiners existed.
    if (due.length > 0) {
      this.comings.shift();
      return this.leave();
    }

    const timerRunning = this.match.snapshot().timerRunning;
    const clockMayRunOut = this.comings.length === 0 && this.rng.next() < TIMER_CHANCE;
    if (timerRunning && (able.length === 0 || clockMayRunOut)) return this.match.timerFired();
    if (able.length === 0) return "stuck";

    const { player, offers } = this.rng.pick(able);
    const action = this.fillIn(this.rng.pick(offers));
    const outcome = this.match.act(player.id, action);
    if (outcome.status === "ignored") {
      // The simulator only sends what the View offers, so this means the simulator and the Engine
      // disagree about what a View offers: a bug in the site, not in the Game.
      this.problems.add(`the simulator's own Action for ${player.name} was ignored (${outcome.why}); this is a bug in the simulator`);
    }
    return outcome;
  }

  /** One of the Players in the Match leaves (never a joiner still waiting: that would be no event). */
  private leave(): Outcome {
    const gone = this.rng.pick(this.match.snapshot().players);
    this.present = this.present.filter((p) => p.id !== gone.id);
    // A leave can make room for a joiner who was waiting.
    return this.noteArrivals(this.match.setPlayers(this.present));
  }

  /** New Players arrive. The Engine takes them in, or leaves them waiting: "ignored", no problem. */
  private join(newcomers: readonly Player[]): Outcome {
    this.present = [...this.present, ...newcomers];
    return this.noteArrivals(this.match.setPlayers(this.present));
  }

  /** Remembers when each joiner got into the Match. */
  private noteArrivals(outcome: Outcome): Outcome {
    for (const p of this.match.snapshot().players) {
      if (this.latecomerIds.has(p.id) && !this.joinedAfter.has(p.id)) this.joinedAfter.set(p.id, this.steps);
    }
    return outcome;
  }

  /** Turns what a View offers into an Action a Player could really send. */
  private fillIn(offer: AvailableAction): unknown {
    switch (offer.kind) {
      case "exact":
        return offer.action;
      case "text":
        return { ...offer.template, text: this.word(offer.maxLength) };
      case "drawing":
        return { ...offer.template, drawing: this.scribble() };
    }
  }

  /** A short made-up word, now and then exactly as long as the box allows. */
  private word(maxLength: number): string {
    const length = this.rng.next() < 0.1 ? maxLength : this.rng.int(1, Math.min(8, maxLength));
    let word = "";
    for (let i = 0; i < length; i++) word += "abcdefghijklmnopqrstuvwxyz"[this.rng.int(0, 25)];
    return word;
  }

  /** A few short strokes in the 1000 by 1000 square, in whole numbers, as the drawing pad sends them. */
  private scribble(): Drawing {
    const strokes = Array.from({ length: this.rng.int(1, 3) }, () => ({
      color: this.rng.pick<Hex>(["#000000", "#e63946", "#1d3557", "#2a9d8f"]),
      width: this.rng.int(2, 20),
      points: Array.from({ length: 2 * this.rng.int(1, 12) }, () => this.rng.int(0, 1000)),
    }));
    return { strokes };
  }

  /**
   * Every Player in the Match at its end, joiners taken in included, should have had something to do
   * at least once. Players who left are not counted, nor joiners who were left waiting.
   */
  private checkEveryoneWasOffered(): void {
    for (const player of this.match.snapshot().players) {
      if (this.offered.has(player.id)) continue;
      const joined = this.joinedAfter.get(player.id);
      this.problems.add(
        joined === undefined
          ? `${player.name} was never offered an Action in the whole Match (${events(this.steps)}). Give every Player something to do`
          : `${player.name} joined after ${events(joined)} and was never offered an Action (the Match took ${events(this.steps)}). Give a Player who joins something to do, or don't take them in`,
      );
    }
  }
}

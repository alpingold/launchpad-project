// SIMULATE: plays a game with bot players on a pretend clock (plan §11c, E4).
//
// The game runs inside the real GameRunner, exactly as on the server, but its timers run
// on a VirtualClock: "wait 20 seconds" takes no real time, so a whole game is played in
// milliseconds. Bots look at the latest view on their phone and tap one of the offered
// buttons, the way a person would. Each scenario adds the kinds of trouble real parties
// have: slow players, junk messages, phones dropping, someone walking away.
//
// Every problem message says what went wrong AND what to do about it, because these
// messages are fed back to the model that wrote the game (A4).

import { performance } from 'node:perf_hooks';
import { GameRunner } from '../GameRunner.js';
import { offeredActions } from '../views.js';
import { seededRandom } from '../random.js';

/** A game must finish within this much simulated time. */
export const SIM_LIMIT_MS = 30 * 60 * 1000;
/** One call into the game (an action, a timer) taking longer than this is too slow. */
export const SLOW_CALL_MS = 100;
/** More views than this from ONE action or timer means the game is flooding the phones. */
export const FLOOD_VIEWS_PER_EVENT = 60;
/** Safety stop for games that keep scheduling timers forever. */
const MAX_EVENTS = 50_000;

/**
 * How the bots behave in each scenario.
 *  - eager:  everyone answers everything, quickly
 *  - sloppy: slow and unreliable players, junk actions, a phone that drops and comes back,
 *            and a host screen that reloads
 *  - quiet:  one player never taps anything, and (with 3+ players) one walks away for good;
 *            the game must still finish on its own
 */
export const SCENARIOS = {
  eager: 'everyone answers everything quickly',
  sloppy: 'slow players, junk actions, a phone that drops and comes back',
  quiet: 'one player never taps, and one leaves for good',
};

/** A pretend clock: timers fire in order, instantly, when the simulation asks for the next one. */
export class VirtualClock {
  now = 0;
  #queue = new Map();
  #nextId = 1;

  setTimeout = (fn, ms) => {
    const id = this.#nextId++;
    this.#queue.set(id, { id, at: this.now + Math.max(0, ms), fn });
    return id;
  };

  clearTimeout = (id) => {
    this.#queue.delete(id);
  };

  get pending() {
    return this.#queue.size;
  }

  /** Removes and returns the earliest timer (ties: the one scheduled first), or null. */
  takeNext() {
    let next = null;
    for (const timer of this.#queue.values()) {
      if (!next || timer.at < next.at || (timer.at === next.at && timer.id < next.id)) next = timer;
    }
    if (next) {
      this.#queue.delete(next.id);
      this.now = next.at;
    }
    return next;
  }
}

/**
 * Plays one game with bots.
 * @param {import('../contract.js').GameModule} game
 * @param {Object} opts
 * @param {number} opts.playerCount
 * @param {keyof typeof SCENARIOS} opts.scenario
 * @param {number} opts.seed
 * @param {Set<string>} opts.assetIds         ids in the art library
 * @param {string} [opts.sourceName]          what to call the game file in error messages
 * @returns {{ playerCount: number, scenario: string, seed: number, where: string, ended: object | null,
 *             simulatedSeconds: number, views: number, problems: string[] }}
 */
export function simulateGame(game, { playerCount, scenario, seed, assetIds, sourceName = 'game.js' }) {
  const where = `${playerCount} player${playerCount === 1 ? '' : 's'}, scenario "${scenario}" (${SCENARIOS[scenario]}), seed ${seed}`;
  const problems = [];
  const problem = (text) => {
    // Bot ids differ between runs; without them, the same bug reads the same everywhere.
    const general = text.replace(/p_bot\d+/g, '<playerId>');
    if (!problems.includes(general)) problems.push(general);
  };
  let tooSlow = false;

  const clock = new VirtualClock();
  const rand = seededRandom(seed * 7919 + playerCount);
  const between = (min, max) => min + rand() * (max - min);
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p_bot${i + 1}`, name: `Bot ${i + 1}` }));

  // What each scenario changes.
  const quietId = scenario === 'quiet' ? players[0].id : null; // never taps
  const leaverId = scenario === 'quiet' && playerCount >= 3 ? players.at(-1).id : null; // walks away at 5 s
  const answerChance = scenario === 'sloppy' ? 0.7 : 1;
  const [minDelay, maxDelay] = scenario === 'sloppy' ? [300, 8000] : [200, 2500];

  const away = new Set();
  const gotView = new Set();
  /** @type {Map<string, object>} the view on each bot's phone right now */
  const screens = new Map();
  let hostGotView = false;
  let views = 0;
  let viewsThisEvent = 0;
  let ended = null;
  const errors = [];

  let runner;
  /**
   * A bot looks at its phone and (maybe) taps one of the offered buttons after a moment.
   * Like a person, it keeps tapping if the same screen is still showing afterwards.
   */
  function botSees(playerId, view) {
    const actions = offeredActions(view);
    if (!actions.length || playerId === quietId || away.has(playerId) || rand() > answerChance) return;
    const action = actions[Math.floor(rand() * actions.length)];
    clock.setTimeout(() => {
      if (away.has(playerId)) return;
      runner.handleAction(playerId, structuredClone(action));
      if (screens.get(playerId) === view) botSees(playerId, view);
    }, between(minDelay, maxDelay));
  }

  function noteAssets(view) {
    for (const id of [view.asset, ...(view.options ?? []).map((o) => o.asset)]) {
      if (id !== undefined && !assetIds.has(id)) {
        problem(`Uses art "${id}", which isn't in the art library. Use only these asset ids: ${[...assetIds].join(', ') || '(none)'}, or leave "asset" out.`);
      }
    }
  }

  runner = new GameRunner({
    game,
    players,
    options: {},
    seed,
    now: () => clock.now,
    timers: clock,
    onLog: () => {},
    onGameError: (label, err) => errors.push({ label, err }),
    deliver: (target, view) => {
      views++;
      viewsThisEvent++;
      noteAssets(view);
      if (target.to === 'all' || target.to === 'host') hostGotView = true;
      const ids = target.to === 'all' ? players.map((p) => p.id) : target.to === 'player' ? [target.playerId] : [];
      for (const id of ids) {
        gotView.add(id);
        screens.set(id, view);
        botSees(id, view);
      }
    },
    onEnd: (results) => {
      ended = results;
    },
  });

  // Trouble that happens at fixed moments in some scenarios.
  if (scenario === 'sloppy') {
    const victim = players[Math.min(1, playerCount - 1)].id;
    clock.setTimeout(() => {
      for (const junk of [{}, { hack: true }, { answer: 99 }, { tap: true, round: -1 }]) runner.handleAction(victim, junk);
    }, 1500);
    clock.setTimeout(() => {
      away.add(victim);
      runner.playerDisconnected(victim);
    }, 4000);
    clock.setTimeout(() => {
      away.delete(victim);
      runner.playerReconnected(victim); // the platform resends their view, and the bot reacts to it
    }, 12_000);
    clock.setTimeout(() => runner.hostReconnected(), 7000);
  }
  if (leaverId) {
    clock.setTimeout(() => {
      away.add(leaverId);
      runner.playerDisconnected(leaverId);
    }, 5000);
  }

  /** Runs one step (start, an action, a timer) and checks it wasn't slow or flooding. */
  function step(label, fn) {
    viewsThisEvent = 0;
    const started = performance.now();
    fn();
    const took = performance.now() - started;
    if (took > SLOW_CALL_MS) {
      tooSlow = true; // stop here: more slow calls would only make the check itself slow
      problem(`Too slow: one ${label} took ${Math.round(took)} ms (limit ${SLOW_CALL_MS} ms). Avoid big loops; games should do very little work per action.`);
    }
    if (viewsThisEvent > FLOOD_VIEWS_PER_EVENT) {
      problem(`Sends too many views at once: ${viewsThisEvent} from one ${label} (limit ${FLOOD_VIEWS_PER_EVENT}). Send each screen one view when its state changes.`);
    }
  }

  step('start', () => runner.start());
  let events = 0;
  while (!ended && !tooSlow && clock.pending > 0 && clock.now <= SIM_LIMIT_MS && events < MAX_EVENTS) {
    const timer = clock.takeNext();
    events++;
    step('action or timer', timer.fn);
  }
  // Bots may still be tapping, so "nothing left to do" is about the GAME's own timers.
  const gameIsWaitingOnNothing = runner.timers.size === 0;
  runner.dispose(); // stop anything still scheduled; the simulation is over

  if (tooSlow) {
    // Already reported; the run was cut short, so its ending says nothing.
  } else if (ended?.error) {
    const { label, err } = errors[0] ?? { label: 'the game', err: new Error('unknown error') };
    const kind = err?.name === 'GameContractError' ? 'Broke the game contract' : 'Crashed';
    problem(`${kind} in ${label}: ${describeError(err, sourceName)}`);
  } else if (!ended && events >= MAX_EVENTS) {
    problem(`Never stops: it kept scheduling timers (${MAX_EVENTS} of them) without ending. Make sure every timer leads toward ctx.endGame.`);
  } else if (!ended && clock.now > SIM_LIMIT_MS && !gameIsWaitingOnNothing) {
    problem(`Didn't finish within ${SIM_LIMIT_MS / 60000} simulated minutes. A party game should end in a few minutes: call ctx.endGame when the last round is over.`);
  } else if (!ended) {
    problem(`Got stuck: it stopped doing anything but never called ctx.endGame. Players can walk away or stop tapping, so every wait for players needs a ctx.setTimeout fallback that moves the game on.`);
  }

  if (!hostGotView && !ended?.error) {
    problem('The host screen never got a view. Send it one with ctx.sendToHost (or ctx.broadcast) when the game starts.');
  }
  const viewless = players.filter((p) => !gotView.has(p.id));
  if (viewless.length && !ended?.error) {
    problem(`${viewless.length === playerCount ? 'No player' : 'Some players'} ever got a view. Send every phone a view with ctx.sendToPlayer (or ctx.broadcast) when the game starts.`);
  }

  return {
    playerCount,
    scenario,
    seed,
    where,
    ended,
    simulatedSeconds: Math.round(clock.now / 1000),
    views,
    problems,
  };
}

/** "TypeError: x is undefined (game.js line 42)", without long internal stack traces. */
export function describeError(err, sourceName) {
  if (!(err instanceof Error)) return String(err);
  const location = err.stack
    ?.split('\n')
    .find((line) => line.includes(sourceName))
    ?.match(/:(\d+):\d+\)?\s*$/);
  return `${err.name}: ${err.message}${location ? ` (${sourceName} line ${location[1]})` : ''}`;
}

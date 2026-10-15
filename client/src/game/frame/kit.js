// party.kit: game-logic helpers for frame games (plan §13o): the machinery every game built
// by the AI wrote by hand (phases with timers, votes, turns, rankings, platformer physics).
// party.ui (ui.js) draws things; party.kit runs things.
//
// Like ui.js, this runs INSIDE the game's sandboxed iframe, put in as text before the SDK.
// It only defines a factory; the SDK calls it with its own `party` and exposes the result as
// `party.kit`. No libraries, no page access beyond timers.
//
// Saving: votes and turns are PLAIN objects the game keeps in its own state, so they go into
// party.save with everything else. Phases keep their state in a plain object too, and come
// back after a reload with resume().
//
//   party.kit.phases(defs, { state, onChange })  named phases with deadlines: go(), resume()
//   party.kit.vote.start/cast/waitingFor/result   a vote among the players
//   party.kit.turns.start/current/next             whose turn, skipping players who left
//   party.kit.rank(scores)                         { rankings, scores, places } for party.end
//   party.kit.platformer(lines, opts)              a tile world with gravity, jumps, platforms
//   party.kit.camera(focus, view, world)           where a scrolling view should start
//   party.kit.colors, colorOf(id), ordinal(n), roll(), between(), pick(), shuffle()

window.__partyKit = function createPartyKit(party) {
  'use strict';

  const connectedIds = () => party.players.filter((p) => p.connected).map((p) => p.id);

  // ---- Phases ----------------------------------------------------------------------------
  /**
   * Named phases, each with an optional time limit, kept in a plain `state` object
   * ({ phase, endsAt }) that the game saves with party.save.
   *   const flow = party.kit.phases({
   *     ask:    { ms: 20000, enter() { ... }, timeout() { flow.go('reveal'); } },
   *     reveal: { ms: 4000, enter() { ... }, timeout() { flow.go(more ? 'ask' : 'final'); } },
   *     final:  { enter() { ... } },                    // no ms: waits until you call go()
   *   }, { state: g.flow, onChange: save });
   *   flow.go('ask');                 // enter() runs; timeout() runs when its time is up
   *   flow.resume();                  // after a reload: the saved phase's timer runs again
   * flow.phase, flow.endsAt (server time, or null), flow.left() (ms left).
   */
  function phases(defs, { state = {}, onChange = () => {} } = {}) {
    let handle = null;
    const arm = () => {
      clearTimeout(handle);
      handle = null;
      const def = defs[state.phase];
      if (!def || state.endsAt == null) return;
      const phaseNow = state.phase;
      const endsAtNow = state.endsAt;
      handle = setTimeout(() => {
        handle = null;
        // Only if nothing moved on meanwhile.
        if (state.phase === phaseNow && state.endsAt === endsAtNow && typeof def.timeout === 'function') def.timeout();
      }, Math.max(0, state.endsAt - party.now()));
    };
    const flow = {
      get phase() {
        return state.phase ?? null;
      },
      get endsAt() {
        return state.endsAt ?? null;
      },
      get state() {
        return state;
      },
      left() {
        return state.endsAt == null ? Infinity : Math.max(0, state.endsAt - party.now());
      },
      /** Starts a phase; opts.ms overrides its time limit (null: no limit). */
      go(name, opts = {}) {
        const def = defs[name];
        if (!def) throw new Error(`party.kit.phases: no phase "${name}"`);
        const ms = 'ms' in opts ? opts.ms : def.ms;
        state.phase = name;
        state.endsAt = typeof ms === 'number' ? party.now() + ms : null;
        clearTimeout(handle);
        handle = null;
        if (typeof def.enter === 'function') def.enter();
        // enter() may have moved on to another phase already: only arm this one if not.
        if (state.phase === name) arm();
        onChange(state);
      },
      /** After a reload: runs the saved phase's timer again (its timeout fires at once if past). */
      resume() {
        arm();
      },
      stop() {
        clearTimeout(handle);
        handle = null;
      },
    };
    return flow;
  }

  // ---- Votes -----------------------------------------------------------------------------
  // A vote is a plain object: { options, votes: { playerId: option }, voters }.
  const vote = {
    /** A new vote. voters: who may vote (default: everyone in the game). */
    start(options, { voters } = {}) {
      return { options: [...options], votes: {}, voters: voters ? [...voters] : party.players.map((p) => p.id) };
    },
    /** Counts a player's vote (they may change it). Returns false if it isn't a real vote. */
    cast(v, playerId, option) {
      if (!v || !v.voters.includes(playerId) || !v.options.includes(option)) return false;
      v.votes[playerId] = option;
      return true;
    },
    /** Connected voters who haven't voted yet: when it's empty, everyone has. */
    waitingFor(v) {
      const here = connectedIds();
      return v.voters.filter((id) => here.includes(id) && !(id in v.votes));
    },
    /**
     * The outcome: { winner, counts, tied } (tied: the options that shared the most votes).
     * No votes at all: every option ties. tie: 'random' (default) picks among the tied;
     * 'first' takes the earliest in `options`; 'none' leaves winner null on a tie.
     */
    result(v, { tie = 'random' } = {}) {
      const counts = Object.fromEntries(v.options.map((o) => [o, 0]));
      for (const option of Object.values(v.votes)) counts[option] += 1;
      const most = Math.max(...Object.values(counts));
      const tied = v.options.filter((o) => counts[o] === most);
      let winner = tied[0];
      if (tied.length > 1) winner = tie === 'none' ? null : tie === 'first' ? tied[0] : pick(tied);
      return { winner, counts, tied };
    },
  };

  // ---- Turns -----------------------------------------------------------------------------
  // Turns are a plain object: { order: [playerId, ...], index, round }.
  const turns = {
    /** Turn order (default: everyone in the game, in join order). Starts with the first. */
    start(order = party.players.map((p) => p.id)) {
      return { order: [...order], index: 0, round: 1 };
    },
    current(t) {
      return t.order[t.index] ?? null;
    },
    /**
     * Moves to the next player who is still connected (round goes up when it wraps).
     * Returns their id, or null if nobody in the order is connected.
     */
    next(t) {
      const here = connectedIds();
      for (let step = 1; step <= t.order.length; step++) {
        const raw = t.index + step;
        const index = raw % t.order.length;
        if (here.includes(t.order[index])) {
          if (raw >= t.order.length) t.round += 1; // went past the end: a new round
          t.index = index;
          return t.order[index];
        }
      }
      return null;
    },
  };

  // ---- Results ---------------------------------------------------------------------------
  /**
   * From scores ({ playerId: number }, higher is better) to what party.end wants, plus places
   * for showing: equal scores share a place (1, 2, 2, 4). Players without a score count as 0.
   * @returns {{ rankings: string[], scores: Object<string, number>, places: Object<string, number> }}
   */
  function rank(scores) {
    const ids = party.players.map((p) => p.id);
    const all = Object.fromEntries(ids.map((id) => [id, Number(scores?.[id]) || 0]));
    const rankings = [...ids].sort((a, b) => all[b] - all[a]);
    const places = {};
    rankings.forEach((id, i) => {
      places[id] = i > 0 && all[id] === all[rankings[i - 1]] ? places[rankings[i - 1]] : i + 1;
    });
    return { rankings, scores: all, places };
  }

  // ---- Small things ----------------------------------------------------------------------
  /** 12 colours that stay distinct and readable on light and dark backgrounds. */
  const colors = Object.freeze(['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#d81b60', '#7cb342', '#5e35b1', '#fdd835', '#6d4c41', '#546e7a']);
  /** A player's colour: the same on every screen, from their place in the game's player list. */
  const colorOf = (playerId) => colors[Math.max(0, party.players.findIndex((p) => p.id === playerId)) % colors.length];
  /** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd" (the number included). */
  function ordinal(n) {
    const tens = n % 100;
    const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
    return `${n}${suffix}`;
  }
  /** A whole number from lo to hi, both included. */
  const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  /** A dice roll: 1..sides. */
  const roll = (sides = 6) => between(1, sides);
  /** A random item of a list (undefined for an empty one). */
  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }
  /** A shuffled copy of a list. */
  function shuffle(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // ---- A scrolling view ------------------------------------------------------------------
  /**
   * Where a view of `view` cells should start so `focus` is in the middle, without showing
   * past the world's edges: camera(player.x, 45, 120) → the first column to show.
   * Works per axis; use it for x and y separately.
   */
  function camera(focus, view, world) {
    if (world <= view) return 0;
    return Math.max(0, Math.min(world - view, Math.round(focus - view / 2)));
  }

  // ---- Platformer physics ----------------------------------------------------------------
  /**
   * A tile world from text lines, with bodies that run, fall and jump. Tiles:
   *   solid (default '#'): walls and floors     oneWay (default '='): land on it from above
   *   anything else is open; bodies report the characters they touch (coins, spikes, exits).
   * Positions are in tiles; a body's x is its LEFT edge and y its FEET.
   *   const world = party.kit.platformer(LEVEL, { run: 7, jump: 15.5 });
   *   const p = world.body(world.find('S')[0]);         // standing on the tile below S
   *   const touched = world.step(p, { left, right, jump }, dt);  // [{ ch, x, y }], or { ch: 'fell' }
   * The defaults (run 7 tiles/s, gravity 45, jump 15.5: ~2.6 tiles high, ~4.8 across;
   * 0.1 s of "coyote time" to jump just after running off an edge) are Tower Dash's.
   */
  function platformer(lines, opts = {}) {
    const o = {
      solid: '#',
      oneWay: '=',
      run: 7,
      gravity: 45,
      jump: 15.5,
      maxFall: 30,
      width: 0.7,
      height: 0.9,
      coyote: 0.1,
      ...opts,
    };
    const grid = lines.map((row) => [...String(row)]);
    const rows = grid.length;
    const cols = Math.max(0, ...grid.map((r) => r.length));
    // Outside the map: the sides and the top are walls; below the bottom is open, so a body
    // can fall out through a hole (and step() reports { ch: 'fell' }).
    const at = (x, y) => (y >= rows ? ' ' : y < 0 || x < 0 || x >= cols ? o.solid : (grid[y][x] ?? ' '));

    function stepOnce(b, input, dt) {
      b.vx = ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * o.run * (b.speed ?? 1);
      b.sinceGround += dt;
      if (input.jump && b.sinceGround <= o.coyote && !b.jumping) {
        b.vy = -o.jump;
        b.jumping = true;
        b.sinceGround = Infinity;
      }
      if (!input.jump) b.jumping = false; // let go to jump again
      b.vy = Math.min(o.maxFall, b.vy + o.gravity * dt);

      // Across: only solid tiles stop a body.
      b.x += b.vx * dt;
      const top = Math.floor(b.y - o.height + 0.001);
      const bottom = Math.floor(b.y - 0.001);
      for (let ty = top; ty <= bottom; ty++) {
        if (b.vx > 0 && at(Math.floor(b.x + o.width), ty) === o.solid) b.x = Math.floor(b.x + o.width) - o.width;
        if (b.vx < 0 && at(Math.floor(b.x), ty) === o.solid) b.x = Math.floor(b.x) + 1;
      }

      // Up and down: solid tiles always; one-way platforms only when landing from above.
      const before = b.y;
      b.y += b.vy * dt;
      const left = Math.floor(b.x + 0.001);
      const right = Math.floor(b.x + o.width - 0.001);
      b.onGround = false;
      if (b.vy > 0) {
        const ty = Math.floor(b.y);
        for (let tx = left; tx <= right; tx++) {
          const ch = at(tx, ty);
          if (ch === o.solid || (ch === o.oneWay && before <= ty + 0.001)) {
            b.y = ty;
            b.vy = 0;
            b.sinceGround = 0;
            b.onGround = true;
            break;
          }
        }
      } else if (b.vy < 0) {
        const ty = Math.floor(b.y - o.height);
        for (let tx = left; tx <= right; tx++) {
          if (at(tx, ty) === o.solid) {
            b.y = ty + 1 + o.height;
            b.vy = 0;
            break;
          }
        }
      }
    }

    return {
      cols,
      rows,
      options: o,
      at,
      /** Changes a tile (e.g. a coin that was picked up: set(x, y, ' ')). */
      set(x, y, ch) {
        if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = ch;
      },
      /** The world as text lines again (for party.ui.ascii). */
      lines() {
        return grid.map((r) => r.join(''));
      },
      /** Every tile with this character: [{ x, y }]. */
      find(ch) {
        const found = [];
        grid.forEach((row, y) => row.forEach((c, x) => c === ch && found.push({ x, y })));
        return found;
      },
      /** A new body standing on the tile below (x, y). A plain object: save it as it is. */
      body({ x, y }) {
        return { x, y: y + 1, vx: 0, vy: 0, sinceGround: 0, jumping: false, onGround: true };
      },
      /**
       * Moves a body by dt seconds (in small steps, so fast bodies don't pass through floors).
       * input: { left, right, jump } (true while held). Returns the open tiles it overlaps
       * that aren't spaces ([{ ch, x, y }]), plus { ch: 'fell' } if it fell out of the world.
       */
      step(b, input = {}, dt) {
        const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
        for (let i = 0; i < steps; i++) stepOnce(b, input, dt / steps);
        const touched = [];
        for (let ty = Math.floor(b.y - o.height); ty <= Math.floor(b.y - 0.001); ty++) {
          for (let tx = Math.floor(b.x); tx <= Math.floor(b.x + o.width - 0.001); tx++) {
            const ch = at(tx, ty);
            if (ch !== ' ' && ch !== o.solid && ch !== o.oneWay) touched.push({ ch, x: tx, y: ty });
          }
        }
        if (b.y > rows + 2) touched.push({ ch: 'fell' });
        return touched;
      },
    };
  }

  return Object.freeze({
    phases,
    vote: Object.freeze(vote),
    turns: Object.freeze(turns),
    rank,
    colors,
    colorOf,
    ordinal,
    between,
    roll,
    pick,
    shuffle,
    camera,
    platformer,
  });
};

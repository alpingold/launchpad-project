// THE `party` SDK (plan §13d): the whole contract between a frame game and BoilerGames.
//
// This file runs INSIDE the game's sandboxed iframe, before the game's own code. It's put
// into the iframe's document as text (GameFrame imports it with Vite's `?raw`), so it can't
// import anything and must not rely on the page around it: it can only talk to it with
// postMessage, the one door the sandbox leaves open.
//
// A game is the same page on the big screen (role 'host': the referee) and on every phone
// (role 'player': the controller):
//
//   party.ready(({ role, me, players, theme, restored }) => { ... })   start here, once connected
//   party.now()                                               server time in ms
//   party.asset(id)                                           URL of an approved picture
//   party.on(name, fn)                                        listen (see below)
//   party.ui.…                                                ready-made pieces (ui.js)
//
//   On a phone:       party.send(data)                        → the big screen's 'event'
//                     party.on('message', fn(data))           one-off messages
//                     party.on('state', fn(state))            what to show now (also after a reload)
//   On the big screen: party.on('event', fn(playerId, data))
//                     party.sendTo(playerId, data) / party.sendAll(data)
//                     party.setState(playerId | 'all', state)
//                     party.save(snapshot)                   kept by the server; if this page
//                                                            reloads, the game starts again with
//                                                            `restored` = the latest snapshot
//                     party.on('left', fn(playerId)) / party.on('back', fn(playerId))
//                     party.end({ rankings: [playerId, ...], scores?: { playerId: number } })
//   Both:             party.on('players', fn(players))        [{ id, name, connected }]
//                     party.on('theme', fn('light' | 'dark'))

(function () {
  'use strict';

  var parentWindow = window.parent;
  var info = null; // from the platform's 'init': { role, me, players, theme, assets }
  var clockOffset = 0; // server time minus this device's time
  var readyCallbacks = [];
  var handlers = { event: [], message: [], state: [], left: [], back: [], players: [], theme: [] };
  var lastState; // a phone's latest state, for handlers added after it arrived
  var hasState = false;

  // The big screen's messages for phones are collected and sent together, at most every
  // BATCH_EVERY_MS: a game can call sendTo/setState as often as it likes (even every frame)
  // without going over the server's rate limit. A newer state for a phone replaces an older
  // one still waiting; messages are all kept, in order.
  var BATCH_EVERY_MS = 50;
  var BATCH_MAX_BYTES = 112 * 1024; // the platform's limit is 120 KB per message
  var pending = []; // [{ to, data } | { to, state }]
  var pendingSave = { has: false, snapshot: undefined };
  var flushTimer = null;
  var lastFlushAt = 0;

  function post(msg) {
    parentWindow.postMessage(msg, '*'); // '*': the sandboxed frame has no origin of its own to name
  }

  /**
   * A JSON copy, taken when the game calls: changing its object afterwards (before the batch
   * goes out) changes nothing, and anything that isn't JSON fails right here, in the game.
   */
  function jsonCopy(value, what) {
    var text = JSON.stringify(value);
    if (text === undefined) throw new Error('party.' + what + ' needs a JSON value');
    return JSON.parse(text);
  }

  function bytes(value) {
    return new Blob([JSON.stringify(value)]).size;
  }

  function scheduleFlush() {
    if (flushTimer !== null) return;
    var wait = Math.max(0, BATCH_EVERY_MS - (Date.now() - lastFlushAt));
    flushTimer = setTimeout(flush, wait);
  }

  /** Sends what's waiting, split into messages under the size limit. */
  function flush() {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    if (pending.length === 0 && !pendingSave.has) return;
    lastFlushAt = Date.now();
    var items = pending;
    var save = pendingSave;
    pending = [];
    pendingSave = { has: false, snapshot: undefined };

    var batch = [];
    var size = 0;
    for (var i = 0; i < items.length; i++) {
      var itemSize = bytes(items[i]);
      if (itemSize > BATCH_MAX_BYTES) {
        console.error('[party] a message for ' + items[i].to + ' is too big (' + itemSize + ' bytes) and was dropped');
        continue;
      }
      if (size + itemSize > BATCH_MAX_BYTES) {
        post({ type: 'batch', items: batch });
        batch = [];
        size = 0;
      }
      batch.push(items[i]);
      size += itemSize;
    }
    var last = { type: 'batch', items: batch };
    if (save.has) {
      if (bytes(save.snapshot) > BATCH_MAX_BYTES - size) {
        if (batch.length > 0) post(last);
        last = { type: 'batch', items: [] };
      }
      last.save = save.snapshot;
    }
    if (last.items.length > 0 || 'save' in last) post(last);
  }

  function queue(item) {
    if ('state' in item) {
      pending = pending.filter(function (waiting) {
        return !('state' in waiting && waiting.to === item.to);
      });
    }
    pending.push(item);
    scheduleFlush();
  }

  function report(error) {
    console.error('[party] the game threw:', error);
  }

  function emit(name, args) {
    var list = handlers[name].slice();
    for (var i = 0; i < list.length; i++) {
      try {
        list[i].apply(null, args);
      } catch (error) {
        report(error);
      }
    }
  }

  function copyPlayers(list) {
    return list.map(function (p) {
      return Object.freeze({ id: p.id, name: p.name, connected: p.connected !== false });
    });
  }

  function requireRole(role, what) {
    if (!info) throw new Error('party.' + what + ' can only be used after party.ready');
    if (info.role !== role) {
      throw new Error('party.' + what + ' is only for the ' + (role === 'host' ? 'big screen' : 'phones'));
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== parentWindow) return; // only the platform page may talk to the game
    var msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (typeof msg.clockOffset === 'number') clockOffset = msg.clockOffset;

    switch (msg.type) {
      case 'init': {
        if (info) return;
        info = Object.freeze({
          role: msg.role,
          me: msg.me,
          players: copyPlayers(msg.players),
          theme: msg.theme,
          assets: msg.assets || {},
          restored: msg.restored, // the big screen's last save, after a reload (else undefined)
        });
        document.documentElement.dataset.theme = info.theme;
        document.documentElement.dataset.role = info.role; // base.css makes the big screen bigger
        // The heartbeat: while this keeps ticking, the game isn't stuck. (If the game hangs,
        // this whole page hangs with it; the server notices the silence: plan §13e.)
        if (info.role === 'host') {
          setInterval(function () {
            post({ type: 'alive' });
          }, 1000);
        }
        var callbacks = readyCallbacks;
        readyCallbacks = [];
        for (var i = 0; i < callbacks.length; i++) {
          try {
            callbacks[i](info);
          } catch (error) {
            report(error);
          }
        }
        break;
      }
      case 'event':
        emit('event', [msg.from, msg.data]);
        break;
      case 'message':
        emit('message', [msg.data]);
        break;
      case 'state':
        lastState = msg.state;
        hasState = true;
        emit('state', [msg.state]);
        break;
      case 'players': {
        if (!info) return;
        var before = {};
        info.players.forEach(function (p) {
          before[p.id] = p.connected;
        });
        var now = copyPlayers(msg.players);
        info = Object.freeze(Object.assign({}, info, { players: now }));
        emit('players', [now]);
        now.forEach(function (p) {
          if (before[p.id] === true && !p.connected) emit('left', [p.id]);
          if (before[p.id] === false && p.connected) emit('back', [p.id]);
        });
        break;
      }
      case 'theme':
        if (!info) return;
        info = Object.freeze(Object.assign({}, info, { theme: msg.theme }));
        document.documentElement.dataset.theme = msg.theme;
        emit('theme', [msg.theme]);
        break;
      case 'refused':
        console.warn('[party] the platform refused a message:', msg.reason);
        break;
    }
  });

  var api = {
    ready: function (fn) {
      if (typeof fn !== 'function') throw new Error('party.ready needs a function');
      if (info) fn(info);
      else readyCallbacks.push(fn);
    },
    on: function (name, fn) {
      if (!Object.prototype.hasOwnProperty.call(handlers, name)) throw new Error('party.on: unknown event "' + name + '"');
      if (typeof fn !== 'function') throw new Error('party.on needs a function');
      handlers[name].push(fn);
      // A phone that starts listening late still gets its current state.
      if (name === 'state' && hasState) {
        try {
          fn(lastState);
        } catch (error) {
          report(error);
        }
      }
    },
    now: function () {
      return Date.now() + clockOffset;
    },
    asset: function (id) {
      return (info && info.assets[id]) || null;
    },
    get role() {
      return info ? info.role : null;
    },
    get me() {
      return info ? info.me : null;
    },
    get players() {
      return info ? info.players : [];
    },
    get theme() {
      return info ? info.theme : 'light';
    },

    // A phone's events, for the big screen.
    send: function (data) {
      requireRole('player', 'send');
      post({ type: 'send', data: data });
    },

    // The big screen.
    sendTo: function (playerId, data) {
      requireRole('host', 'sendTo');
      queue({ to: playerId, data: jsonCopy(data, 'sendTo') });
    },
    sendAll: function (data) {
      requireRole('host', 'sendAll');
      queue({ to: 'all', data: jsonCopy(data, 'sendAll') });
    },
    setState: function (to, state) {
      requireRole('host', 'setState');
      queue({ to: to, state: jsonCopy(state, 'setState') });
    },
    save: function (snapshot) {
      requireRole('host', 'save');
      pendingSave = { has: true, snapshot: jsonCopy(snapshot, 'save') };
      scheduleFlush();
    },
    get restored() {
      return info ? info.restored : undefined;
    },
    end: function (results) {
      requireRole('host', 'end');
      flush(); // everything sent before the game ended arrives before the end
      post({ type: 'end', results: results });
    },
  };

  // party.ui: the helpers from ui.js, which ran just before this and left its factory here.
  api.ui = typeof window.__partyUi === 'function' ? window.__partyUi(api) : null;
  delete window.__partyUi;
  window.party = Object.freeze(api);

  post({ type: 'loaded' }); // the platform answers with 'init'
})();

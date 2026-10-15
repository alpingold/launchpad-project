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
//   party.ready(({ role, me, players, theme }) => { ... })    start here, once connected
//   party.now()                                               server time in ms
//   party.asset(id)                                           URL of an approved picture
//   party.on(name, fn)                                        listen (see below)
//
//   On a phone:       party.send(data)                        → the big screen's 'event'
//                     party.on('message', fn(data))           one-off messages
//                     party.on('state', fn(state))            what to show now (also after a reload)
//   On the big screen: party.on('event', fn(playerId, data))
//                     party.sendTo(playerId, data) / party.sendAll(data)
//                     party.setState(playerId | 'all', state)
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

  function post(msg) {
    parentWindow.postMessage(msg, '*'); // '*': the sandboxed frame has no origin of its own to name
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
        });
        document.documentElement.dataset.theme = info.theme;
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

  window.party = Object.freeze({
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
      post({ type: 'sendTo', to: playerId, data: data });
    },
    sendAll: function (data) {
      requireRole('host', 'sendAll');
      post({ type: 'sendTo', to: 'all', data: data });
    },
    setState: function (to, state) {
      requireRole('host', 'setState');
      post({ type: 'setState', to: to, state: state });
    },
    end: function (results) {
      requireRole('host', 'end');
      post({ type: 'end', results: results });
    },
  });

  post({ type: 'loaded' }); // the platform answers with 'init'
})();

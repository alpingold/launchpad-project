import { useCallback, useRef, useState } from 'react';

/**
 * One running frame game, as this page knows it (from game:started).
 * @typedef {Object} GameRun
 * @property {string} gameId
 * @property {string} runId      changes with every game, so a page can tell a new game from its own
 * @property {string} source     the game file, shown in GameFrame's iframe
 * @property {{ id: string, name: string }[]} players  everyone in the game
 * @property {number} clockOffset  server time minus this device's time, at the start
 * @property {unknown} [restored]  the big screen's latest save, when this page came back mid-game
 * @property {{ push: (msg: object) => void, listen: (fn: (msg: object) => void) => () => void }} channel
 *   the server's messages for the game, kept until GameFrame listens
 */

/**
 * Keeps track of the game messages a page receives. Shared by the host and join pages.
 *
 * Returns [game, handleGameMessage, runRef]:
 *  - game.run          the running game (null between games)
 *  - game.lastResults  results of the last finished game, for the lobby ("Alex won!")
 *  - handleGameMessage(msg) handles game:* messages; returns true if it handled one
 *  - runRef.current    the same run, readable inside socket callbacks
 */
export function useGameMessages() {
  const [game, setGame] = useState({ run: null, lastResults: null });
  const runRef = useRef(null);

  const handleGameMessage = useCallback((msg) => {
    const clockOffset = typeof msg.serverNow === 'number' ? msg.serverNow - Date.now() : 0;
    switch (msg.type) {
      case 'game:started': {
        // The same game we're already showing: only the connection blipped. Keep going.
        if (runRef.current?.runId === msg.runId) return true;
        /** @type {GameRun} */
        const run = {
          gameId: msg.gameId,
          runId: msg.runId,
          source: msg.source,
          players: msg.players,
          clockOffset,
          channel: createChannel(),
        };
        if ('snapshot' in msg) run.restored = msg.snapshot;
        runRef.current = run;
        setGame({ run, lastResults: null });
        return true;
      }
      case 'game:event':
      case 'game:message':
      case 'game:state':
        runRef.current?.channel.push({ ...msg, clockOffset });
        return true;
      case 'game:ended':
        runRef.current = null;
        setGame({ run: null, lastResults: msg.results });
        return true;
      default:
        return false;
    }
  }, []);

  return [game, handleGameMessage, runRef];
}

/** A queue that holds messages until someone listens, then hands them over as they come. */
function createChannel() {
  let queue = [];
  let listener = null;
  return {
    push(msg) {
      if (listener) listener(msg);
      else queue.push(msg);
    },
    listen(fn) {
      listener = fn;
      const waiting = queue;
      queue = [];
      waiting.forEach(fn);
      return () => {
        if (listener === fn) listener = null;
      };
    },
  };
}

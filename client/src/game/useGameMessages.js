import { useCallback, useState } from 'react';

/**
 * Keeps track of the game messages one screen receives. Shared by the host and join pages.
 *
 * Returns [game, handleGameMessage]:
 *  - game.view         the latest view for this screen (null between games)
 *  - game.viewKey      goes up with every new view (lets GameScreen reset after a bad view)
 *  - game.clockOffset  server time minus this device's time, for countdowns
 *  - game.lastResults  results of the last finished game, for the lobby ("Alex won!")
 *  - handleGameMessage(msg) updates the state for game:* messages; returns true if it handled one
 */
export function useGameMessages() {
  const [game, setGame] = useState({ view: null, viewKey: 0, clockOffset: 0, lastResults: null });

  const handleGameMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'game:started':
        setGame((g) => ({ ...g, view: null, lastResults: null }));
        return true;
      case 'game:message':
        setGame((g) => ({
          ...g,
          view: msg.payload,
          viewKey: g.viewKey + 1,
          clockOffset: typeof msg.serverNow === 'number' ? msg.serverNow - Date.now() : 0,
        }));
        return true;
      case 'game:ended':
        setGame((g) => ({ ...g, view: null, lastResults: msg.results }));
        return true;
      default:
        return false;
    }
  }, []);

  return [game, handleGameMessage];
}

import { useCallback, useState } from 'react';

/**
 * Keeps track of the game messages one screen receives. Shared by the host and join pages.
 *
 * Returns [game, handleGameMessage]:
 *  - game.screen         the latest screen for this phone or the big screen (null between games)
 *  - game.screenKey      goes up with every new screen (lets GameScreen reset after a bad one)
 *  - game.clockOffset  server time minus this device's time, for timers
 *  - game.lastResults  results of the last finished game, for the lobby ("Alex won!")
 *  - handleGameMessage(msg) updates the state for game:* messages; returns true if it handled one
 */
export function useGameMessages() {
  const [game, setGame] = useState({ screen: null, screenKey: 0, clockOffset: 0, lastResults: null });

  const handleGameMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'game:started':
        setGame((g) => ({ ...g, screen: null, lastResults: null }));
        return true;
      case 'game:message':
        setGame((g) => ({
          ...g,
          screen: msg.payload,
          screenKey: g.screenKey + 1,
          clockOffset: typeof msg.serverNow === 'number' ? msg.serverNow - Date.now() : 0,
        }));
        return true;
      case 'game:ended':
        setGame((g) => ({ ...g, screen: null, lastResults: msg.results }));
        return true;
      default:
        return false;
    }
  }, []);

  return [game, handleGameMessage];
}

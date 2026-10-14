import { createContext, useContext } from 'react';

/**
 * What every block on a screen may need, without passing it through every layout block:
 *  - players      [{ id, name }] from room:state, for names (games send ids, never names)
 *  - youId        this phone's player id (null on the big screen)
 *  - onAction     sends game:action (null on the big screen: buttons are shown, not tappable)
 *  - clockOffset  server time minus this device's time, for timers
 */
export const ScreenContext = createContext({ players: [], youId: null, onAction: null, clockOffset: 0 });

export const useScreen = () => useContext(ScreenContext);

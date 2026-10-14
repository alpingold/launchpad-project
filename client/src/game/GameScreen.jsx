import { Component } from 'react';
import { Blocks } from './blocks/index.jsx';
import { ScreenContext } from './blocks/context.js';

/**
 * Draws the latest screen a game sent: a list of blocks (plan §12b). This is how games show
 * anything at all: they send data, and trusted components decide how it looks. No game
 * code ever runs in the browser.
 *
 * @param {Object} props
 * @param {{ blocks: object[] } | null} props.screen latest game:message payload (a list of blocks)
 * @param {number} props.screenKey            increases with every new screen (resets the error boundary)
 * @param {{id: string, name: string}[]} props.players  for looking up names
 * @param {string} [props.youId]
 * @param {(action: object, input?: unknown) => void} [props.onAction]   phones only; sends game:action
 * @param {number} [props.clockOffset]        server time minus device time, for timers
 */
export default function GameScreen({ screen, screenKey, players, youId = null, onAction = null, clockOffset = 0 }) {
  if (!Array.isArray(screen?.blocks)) return <Waiting />;
  return (
    <ScreenContext.Provider value={{ players, youId, onAction, clockOffset }}>
      <ScreenErrorBoundary key={screenKey}>
        <div className="view">
          <Blocks blocks={screen.blocks} />
        </div>
      </ScreenErrorBoundary>
    </ScreenContext.Provider>
  );
}

function Waiting() {
  return (
    <div className="view">
      <p className="muted">Waiting…</p>
    </div>
  );
}

/**
 * If a screen has something the components can't draw (the server should have caught this,
 * but the client double-checks by not crashing), show "Waiting…" instead of a blank page.
 * React only supports this "catch errors while drawing" feature in class components.
 */
class ScreenErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn('[game] could not draw screen:', error);
  }

  render() {
    return this.state.failed ? <Waiting /> : this.props.children;
  }
}

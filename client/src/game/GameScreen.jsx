import { Component } from 'react';
import MessageView from './views/MessageView.jsx';
import ButtonView from './views/ButtonView.jsx';
import ChoiceView from './views/ChoiceView.jsx';
import CountdownView from './views/CountdownView.jsx';
import ScoreboardView from './views/ScoreboardView.jsx';

// One trusted component per view kind. Must match server/src/games/views.js
// (a server test checks that every kind there has a file here).
const VIEW_COMPONENTS = {
  message: MessageView,
  button: ButtonView,
  choice: ChoiceView,
  countdown: CountdownView,
  scoreboard: ScoreboardView,
};

/**
 * Draws the latest view a game sent. This is how games show anything at all: they send
 * data, and these trusted components decide how it looks (plan §4a). No game code ever
 * runs in the browser.
 *
 * @param {Object} props
 * @param {object | null} props.view          latest game:message payload for this screen
 * @param {number} props.viewKey              increases with every new view (resets the error boundary)
 * @param {{id: string, name: string}[]} props.players  for looking up names
 * @param {string} [props.youId]
 * @param {(action: object) => void} [props.onAction]   phones only; sends game:action
 * @param {number} [props.clockOffset]        server time minus device time, for countdowns
 */
export default function GameScreen({ view, viewKey, players, youId, onAction, clockOffset }) {
  const ViewComponent = view && Object.hasOwn(VIEW_COMPONENTS, view.view) ? VIEW_COMPONENTS[view.view] : null;
  if (!ViewComponent) return <Waiting />;
  return (
    <ViewErrorBoundary key={viewKey}>
      <ViewComponent view={view} players={players} youId={youId} onAction={onAction} clockOffset={clockOffset} />
    </ViewErrorBoundary>
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
 * If a view has fields the component can't draw (the server should have caught this, but
 * the client double-checks by not crashing), show "Waiting…" instead of a blank page.
 * React only supports this "catch errors while drawing" feature in class components.
 */
class ViewErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn('[game] could not draw view:', error);
  }

  render() {
    return this.state.failed ? <Waiting /> : this.props.children;
  }
}

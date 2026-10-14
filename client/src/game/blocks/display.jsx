import { useEffect, useState } from 'react';
import { AssetImage } from '../assets.jsx';
import { useScreen } from './context.js';

// Display blocks: things to look at. All text is React text, so a game can never inject HTML.

/** Big and huge text is a screen's main message, so it's a heading (screen readers can jump to it). */
export function Text({ block }) {
  const size = block.size ?? 'normal';
  const classes = ['blk-text', `size-${size}`, `tone-${block.tone ?? 'normal'}`, `align-${block.align ?? 'center'}`];
  if (block.bold) classes.push('bold');
  const Tag = size === 'big' || size === 'huge' ? 'h2' : 'p';
  return <Tag className={classes.join(' ')}>{block.text}</Tag>;
}

export function Image({ block }) {
  return (
    <div className={`blk-image size-${block.size ?? 'normal'}`}>
      <AssetImage id={block.asset} />
    </div>
  );
}

/** The current server time, updated a few times a second (for timers). */
function useServerNow() {
  const { clockOffset } = useScreen();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  // Phones' clocks are often a few seconds off. clockOffset (server time minus this device's
  // time) corrects for that, so every screen shows the same time left at the same moment.
  return now + clockOffset;
}

export function Timer({ block }) {
  const now = useServerNow();
  const msLeft = Math.max(0, block.endsAt - now);
  const seconds = Math.ceil(msLeft / 1000);
  if (block.style === 'bar') {
    const fraction = Math.min(1, msLeft / (block.endsAt - block.startedAt));
    return (
      <div className="blk-timer-bar" role="timer" aria-label={`${block.label ?? 'Time left'}: ${seconds} seconds`}>
        {/* The seconds are always shown, so a timer bar never looks like a progress bar. */}
        <span className="blk-bar-label" aria-hidden="true">
          <span>{block.label ?? 'Time left'}</span>
          <span className="blk-bar-seconds">{seconds}s</span>
        </span>
        <div className="blk-bar">
          <div className={`blk-bar-fill${seconds <= 5 ? ' tone-bad' : ''}`} style={{ width: `${fraction * 100}%` }} />
        </div>
      </div>
    );
  }
  return (
    <div className="blk-timer" role="timer">
      {block.label && <span className="blk-bar-label">{block.label}</span>}
      <p className="countdown-number">{seconds}</p>
    </div>
  );
}

export function Progress({ block }) {
  const fraction = Math.min(1, block.value / block.max);
  return (
    <div className="blk-progress">
      {block.label && <span className="blk-bar-label">{block.label}</span>}
      <div className="blk-bar" role="progressbar" aria-valuenow={block.value} aria-valuemin={0} aria-valuemax={block.max} aria-label={block.label}>
        <div className={`blk-bar-fill tone-${block.tone ?? 'accent'}`} style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}

/** Rows in the order the game sent. Names come from the room's player list (as plain text). */
export function Scoreboard({ block }) {
  const { players, youId } = useScreen();
  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  return (
    <ol className="scoreboard">
      {block.rows.map((row) => (
        <li key={row.playerId} className={row.playerId === youId ? 'you' : ''}>
          <span className="scoreboard-name">
            {nameOf.get(row.playerId) ?? '(left the room)'}
            {row.playerId === youId && ' (you)'}
          </span>
          <span className="scoreboard-score">{row.score}</span>
        </li>
      ))}
    </ol>
  );
}

export function PlayerName({ block }) {
  const { players, youId } = useScreen();
  const name = players.find((p) => p.id === block.playerId)?.name ?? '(left the room)';
  return (
    <p className={`blk-text bold size-${block.size ?? 'normal'} tone-${block.tone ?? 'normal'}`}>
      {name}
      {block.playerId === youId && ' (you)'}
    </p>
  );
}

export function Divider() {
  return <hr className="blk-divider" />;
}

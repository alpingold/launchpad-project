import { useEffect, useRef, useState } from 'react';
import { useScreen } from './context.js';
import { useServerNow } from './display.jsx';
import { CANVAS_WIDTH, CANVAS_HEIGHT, MAX_POINTS, COLORS, Strokes } from './drawing.jsx';

// Widgets (plan §12b): the phone does the fast part itself and sends ONE result. Timing is
// measured on the phone, so a slow network doesn't cost anyone a reflex round. Start times
// come from the server (goAt, startsAt), corrected by clockOffset so all phones agree.
// The server checks every result again before the game sees it.
//
// Each widget sends at most once per screen; a new screen from the game remounts it.

/** Milliseconds until a server time, on this device's clock. */
function msUntil(serverTime, clockOffset) {
  return serverTime - (Date.now() + clockOffset);
}

/** Calls the latest onAction from timers without restarting them when it changes. */
function useSend(block) {
  const { onAction } = useScreen();
  const ref = useRef(onAction);
  ref.current = onAction;
  const sent = useRef(false);
  return (input) => {
    if (!ref.current || sent.current) return false;
    sent.current = true;
    ref.current(block.action, input);
    return true;
  };
}

// --- reaction ---------------------------------------------------------------------------

export function Reaction({ block }) {
  const { onAction, clockOffset } = useScreen();
  const send = useSend(block);
  const [phase, setPhase] = useState('wait'); // wait → go → done
  const [result, setResult] = useState(null);
  const goShownAt = useRef(0);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        goShownAt.current = performance.now();
        setPhase((p) => (p === 'wait' ? 'go' : p));
      },
      Math.max(0, msUntil(block.goAt, clockOffset)),
    );
    return () => clearTimeout(timer);
  }, [block.goAt, clockOffset]);

  function tap() {
    if (phase === 'done') return;
    if (phase === 'wait') {
      if (send({ early: true })) setResult('Too soon!');
    } else {
      const ms = Math.min(10_000, Math.max(80, Math.round(performance.now() - goShownAt.current)));
      if (send({ ms })) setResult(`${ms} ms`);
    }
    setPhase('done');
  }

  const label = phase === 'go' ? (block.goLabel ?? 'TAP!') : phase === 'wait' ? (block.waitLabel ?? 'Wait for it…') : result;
  return (
    <button
      type="button"
      className={`game-button size-big widget-reaction ${phase === 'go' ? 'tone-good' : phase === 'wait' ? 'tone-muted' : 'tone-accent'}`}
      disabled={!onAction || phase === 'done'}
      // Pointer down, not click: a click fires on release, which would add ~100 ms.
      onPointerDown={tap}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && tap()}
    >
      <span>{label}</span>
    </button>
  );
}

// --- mash -------------------------------------------------------------------------------

export function Mash({ block }) {
  const { onAction, clockOffset } = useScreen();
  const send = useSend(block);
  const now = useServerNow();
  const [phase, setPhase] = useState('ready'); // ready → go → done
  const [taps, setTaps] = useState(0);
  const tapsRef = useRef(0);
  const maxTaps = Math.ceil((block.durationMs / 1000) * 20);

  useEffect(() => {
    const startIn = msUntil(block.startsAt, clockOffset);
    const start = setTimeout(() => setPhase((p) => (p === 'ready' ? 'go' : p)), Math.max(0, startIn));
    const end = setTimeout(
      () => {
        setPhase('done');
        send({ taps: Math.min(maxTaps, tapsRef.current) });
      },
      Math.max(0, startIn + block.durationMs),
    );
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
    // Runs once per screen: a screen's blocks never change while it's showing.
  }, []);

  function tap() {
    if (phase !== 'go') return;
    tapsRef.current++;
    setTaps(tapsRef.current);
  }

  const secondsToStart = Math.max(1, Math.ceil((block.startsAt - now) / 1000));
  const secondsLeft = Math.max(0, Math.ceil((block.startsAt + block.durationMs - now) / 1000));
  return (
    <div className="widget">
      <p className="widget-status" role="status">
        {phase === 'ready' && `Get ready… ${secondsToStart}`}
        {phase === 'go' && `${secondsLeft}s left`}
        {phase === 'done' && 'Time!'}
      </p>
      <button
        type="button"
        className={`game-button size-big ${phase === 'go' ? 'tone-good' : 'tone-muted'}`}
        disabled={!onAction || phase !== 'go'}
        onPointerDown={tap}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && tap()}
      >
        <span>{phase === 'go' ? (block.label ?? 'TAP!') : `${taps} taps`}</span>
        {phase === 'go' && <span className="widget-count">{taps}</span>}
      </button>
    </div>
  );
}

// --- timingBar --------------------------------------------------------------------------

export function TimingBar({ block }) {
  const { onAction } = useScreen();
  const send = useSend(block);
  const period = block.periodMs ?? 1500;
  const [position, setPosition] = useState(0); // 0–1000
  const [stopped, setStopped] = useState(false);
  const stoppedRef = useRef(false);

  useEffect(() => {
    const start = performance.now();
    let frame;
    const move = () => {
      if (stoppedRef.current) return;
      // Back and forth: 0 → 1000 in one period, then 1000 → 0.
      const t = ((performance.now() - start) % (2 * period)) / period;
      setPosition(Math.round((t <= 1 ? t : 2 - t) * 1000));
      frame = requestAnimationFrame(move);
    };
    frame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frame);
  }, [period]);

  function stop() {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    setStopped(true);
    send({ position });
  }

  const inside = position >= block.target.from && position <= block.target.to;
  return (
    <div className="widget">
      {block.label && <p className="blk-input-label">{block.label}</p>}
      <div className="widget-timing" role="img" aria-label={`Marker at ${Math.round(position / 10)}%`}>
        <div className="widget-timing-target" style={{ left: `${block.target.from / 10}%`, width: `${(block.target.to - block.target.from) / 10}%` }} />
        <div className="widget-timing-marker" style={{ left: `${position / 10}%` }} />
      </div>
      <button
        type="button"
        className={`game-button size-big ${stopped ? (inside ? 'tone-good' : 'tone-bad') : 'tone-accent'}`}
        disabled={!onAction || stopped}
        onPointerDown={stop}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && stop()}
      >
        <span>{stopped ? (inside ? 'Nailed it!' : 'Missed!') : (block.stopLabel ?? 'STOP!')}</span>
      </button>
    </div>
  );
}

// --- tapTargets -------------------------------------------------------------------------

/** The same small seeded random-number generator on every phone, so targets match. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function TapTargets({ block }) {
  const { onAction, clockOffset } = useScreen();
  const send = useSend(block);
  const now = useServerNow();
  const [phase, setPhase] = useState('ready'); // ready → go → done
  const [hits, setHits] = useState(0);
  const hitsRef = useRef(0); // the same count, readable from the end-of-time timer
  const startedAt = useRef(0);
  // Target spots (percent of the arena), kept away from the edges.
  const [spots] = useState(() => {
    const rand = seededRandom(block.seed);
    return Array.from({ length: block.count }, () => ({ x: 8 + rand() * 84, y: 10 + rand() * 80 }));
  });

  useEffect(() => {
    const startIn = msUntil(block.startsAt, clockOffset);
    const start = setTimeout(
      () => {
        startedAt.current = performance.now();
        setPhase((p) => (p === 'ready' ? 'go' : p));
      },
      Math.max(0, startIn),
    );
    const end = setTimeout(
      () => {
        setPhase('done');
        send({ hits: hitsRef.current, ms: block.durationMs }); // does nothing if all were hit already
      },
      Math.max(0, startIn + block.durationMs),
    );
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
    // Runs once per screen, like Mash.
  }, []);

  function hit() {
    if (phase !== 'go') return;
    const next = hits + 1;
    hitsRef.current = next;
    setHits(next);
    if (next === block.count) {
      setPhase('done');
      send({ hits: next, ms: Math.min(block.durationMs, Math.round(performance.now() - startedAt.current)) });
    }
  }

  const secondsToStart = Math.max(1, Math.ceil((block.startsAt - now) / 1000));
  const secondsLeft = Math.max(0, Math.ceil((block.startsAt + block.durationMs - now) / 1000));
  const spot = spots[hits];
  return (
    <div className="widget">
      <p className="widget-status" role="status">
        {phase === 'ready' && `Get ready… ${secondsToStart}`}
        {phase === 'go' && `${hits}/${block.count} · ${secondsLeft}s left`}
        {phase === 'done' && `${hits}/${block.count} hit!`}
      </p>
      <div className="widget-arena">
        {phase === 'go' && spot && (
          <button
            type="button"
            className="widget-target"
            aria-label={`Target ${hits + 1}`}
            disabled={!onAction}
            style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
            onPointerDown={hit}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && hit()}
          />
        )}
      </div>
    </div>
  );
}

// --- drawPad ----------------------------------------------------------------------------

/** Skip points closer than this to the last one (in canvas units): keeps drawings small. */
const MIN_STEP = 6;

export function DrawPad({ block }) {
  const { onAction } = useScreen();
  const send = useSend(block);
  const colors = block.colors ?? ['black'];
  const [color, setColor] = useState(colors[0]);
  const [strokes, setStrokes] = useState([]);
  const [sent, setSent] = useState(false);
  const drawing = useRef(false);
  const svg = useRef(null);
  const locked = !onAction || sent;
  const pointCount = strokes.reduce((n, s) => n + s.points.length / 2, 0);

  /** A pointer position as whole canvas coordinates (0–1000, 0–750). */
  function toCanvas(e) {
    const box = svg.current.getBoundingClientRect();
    const clamp = (v, max) => Math.min(max, Math.max(0, Math.round(v)));
    return [clamp(((e.clientX - box.left) / box.width) * CANVAS_WIDTH, CANVAS_WIDTH), clamp(((e.clientY - box.top) / box.height) * CANVAS_HEIGHT, CANVAS_HEIGHT)];
  }

  function down(e) {
    if (locked || pointCount >= MAX_POINTS) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    setStrokes((s) => [...s, { color, points: toCanvas(e) }]);
  }

  function move(e) {
    if (!drawing.current) return;
    const [x, y] = toCanvas(e);
    setStrokes((s) => {
      const total = s.reduce((n, st) => n + st.points.length / 2, 0);
      const last = s.at(-1);
      const p = last.points;
      if (total >= MAX_POINTS || Math.hypot(x - p.at(-2), y - p.at(-1)) < MIN_STEP) return s;
      return [...s.slice(0, -1), { ...last, points: [...p, x, y] }];
    });
  }

  function up() {
    drawing.current = false;
  }

  return (
    <div className="widget widget-drawpad">
      {block.label && <p className="blk-input-label">{block.label}</p>}
      <svg
        ref={svg}
        className="drawing-paper drawpad-canvas"
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        role="img"
        aria-label="Drawing area"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <Strokes strokes={strokes} />
      </svg>
      {pointCount >= MAX_POINTS && <p className="muted small">Out of ink! Undo some lines, or send it.</p>}
      <div className="drawpad-tools">
        {colors.length > 1 &&
          colors.map((c) => (
            <button
              key={c}
              type="button"
              className={`drawpad-swatch${c === color ? ' on' : ''}`}
              style={{ background: COLORS[c] }}
              aria-label={c}
              aria-pressed={c === color}
              disabled={locked}
              onClick={() => setColor(c)}
            />
          ))}
        <button type="button" className="secondary-button" disabled={locked || strokes.length === 0} onClick={() => setStrokes((s) => s.slice(0, -1))}>
          Undo
        </button>
        <button type="button" className="secondary-button" disabled={locked || strokes.length === 0} onClick={() => setStrokes([])}>
          Clear
        </button>
      </div>
      <button
        type="button"
        className="game-button tone-accent"
        disabled={locked || strokes.length === 0}
        onClick={() => {
          if (send({ strokes })) setSent(true);
        }}
      >
        {sent ? 'Sent ✓' : (block.submitLabel ?? 'Send')}
      </button>
    </div>
  );
}

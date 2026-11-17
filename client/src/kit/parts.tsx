/**
 * One React component per Part of the Kit. Each draws only the fields kit.ts lists for its Part,
 * each by name: a View is a Game's data, and nothing in it ever becomes markup, a prop spread or an
 * event handler of its own. The colours come from the CSS variables set on the View's root.
 */
import type {
  ButtonPart,
  Drawing,
  DrawingPadPart,
  DrawingPart,
  Hex,
  PicturePart,
  PlayerListPart,
  ScoreboardPart,
  Shape,
  TextInputPart,
  TextPart,
} from "@boilergames/sdk/v1";
import { DEFAULT_TEXT_INPUT_LENGTH, DRAWING_SIZE } from "@boilergames/sdk/v1/check";
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { Ink } from "./ink.js";
import { cssColor } from "./look-style.js";

/** What every Part may need besides its own fields. */
export interface PartContext {
  /** Player names by Seat id, from the Room. */
  readonly names: ReadonlyMap<string, string>;
  /** Sends an Action. Absent on the Screen, which has no inputs. */
  readonly onAction: ((action: unknown) => void) | undefined;
  /** When the Match's timer runs out (Date.now() time), or null when it isn't running. */
  readonly timerEndsAt: number | null;
}

const nameOf = (context: PartContext, id: string) => context.names.get(id) ?? "Someone who left";

export function Text({ part }: { part: TextPart }) {
  return (
    <p className="kit-text" data-size={part.size ?? "normal"} data-tone={part.tone ?? "plain"}>
      {part.text}
    </p>
  );
}

export function Timer({ context }: { context: PartContext }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (context.timerEndsAt === null) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [context.timerEndsAt]);
  if (context.timerEndsAt === null) return null;
  const seconds = Math.max(0, Math.ceil((context.timerEndsAt - now) / 1000));
  return (
    <p className="kit-timer" role="timer" aria-label={`${seconds} seconds left`}>
      {seconds}
    </p>
  );
}

export function Scoreboard({ part, context }: { part: ScoreboardPart; context: PartContext }) {
  const rows = Object.entries(part.scores).sort((a, b) => b[1] - a[1]);
  return (
    <section className="kit-scoreboard">
      {part.title === undefined ? null : <h2>{part.title}</h2>}
      <ol>
        {rows.map(([id, score]) => (
          <li key={id}>
            <span>{nameOf(context, id)}</span>
            <strong>{score}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

const MARKS = { waiting: "waiting", done: "done", active: "their turn", out: "out" } as const;

export function PlayerList({ part, context }: { part: PlayerListPart; context: PartContext }) {
  return (
    <ul className="kit-players">
      {part.players.map((player) => (
        <li key={player.id} data-mark={player.mark ?? "none"}>
          <span className="kit-player-name">{nameOf(context, player.id)}</span>
          {player.mark === undefined ? null : <span className="kit-player-mark">{MARKS[player.mark]}</span>}
          {player.note === undefined ? null : <span className="kit-player-note">{player.note}</span>}
        </li>
      ))}
    </ul>
  );
}

/** A Drawing's strokes as SVG lines in the 1000-square. */
function Strokes({ drawing }: { drawing: Drawing }) {
  return (
    <>
      {drawing.strokes.map((stroke, i) => {
        const pairs: string[] = [];
        for (let p = 0; p + 1 < stroke.points.length; p += 2) pairs.push(`${stroke.points[p]},${stroke.points[p + 1]}`);
        // A single point is drawn as a dot: a line to itself.
        if (pairs.length === 1) pairs.push(pairs[0]!);
        return <polyline key={i} points={pairs.join(" ")} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />;
      })}
    </>
  );
}

export function DrawingView({ part, context }: { part: DrawingPart; context: PartContext }) {
  return (
    <figure className="kit-drawing">
      <svg viewBox={`0 0 ${DRAWING_SIZE} ${DRAWING_SIZE}`} role="img" aria-label="a drawing">
        <rect width={DRAWING_SIZE} height={DRAWING_SIZE} fill="var(--kit-surface)" />
        <Strokes drawing={part.drawing} />
      </svg>
      {part.by === undefined ? null : <figcaption>by {nameOf(context, part.by)}</figcaption>}
    </figure>
  );
}

export function Picture({ part, context }: { part: PicturePart<unknown>; context: PartContext }) {
  return (
    <svg className="kit-picture" viewBox={`0 0 ${part.width} ${part.height}`} role="img" aria-label="a picture">
      {part.shapes.map((shape, i) => (
        <PictureShape key={i} shape={shape} onAction={context.onAction} />
      ))}
    </svg>
  );
}

/** One shape: its own fields, by name, and a tap only where the shape carries an Action and the page can send one. */
function PictureShape({ shape, onAction }: { shape: Shape<unknown>; onAction: PartContext["onAction"] }) {
  const tappable = shape.action !== undefined && onAction !== undefined;
  const style = {
    fill: cssColor(shape.fill) ?? (shape.shape === "line" ? "none" : "var(--kit-text)"),
    stroke: cssColor(shape.stroke),
    strokeWidth: shape.strokeWidth,
    opacity: shape.opacity,
    cursor: tappable ? "pointer" : undefined,
  };
  // The page's own handlers, built here; nothing from the shape is spread in.
  const tap = tappable
    ? {
        onClick: () => onAction(shape.action),
        role: "button",
        tabIndex: 0,
        onKeyDown: (event: { key: string }) => {
          if (event.key === "Enter" || event.key === " ") onAction(shape.action);
        },
      }
    : {};
  switch (shape.shape) {
    case "rect":
      return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.radius} style={style} {...tap} />;
    case "circle":
      return <circle cx={shape.x} cy={shape.y} r={shape.r} style={style} {...tap} />;
    case "line":
      return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} style={{ ...style, stroke: style.stroke ?? "var(--kit-text)" }} {...tap} />;
    case "polygon": {
      const pairs: string[] = [];
      for (let p = 0; p + 1 < shape.points.length; p += 2) pairs.push(`${shape.points[p]},${shape.points[p + 1]}`);
      return <polygon points={pairs.join(" ")} style={style} {...tap} />;
    }
    case "path":
      return <path d={shape.d} style={style} {...tap} />;
    case "label":
      return (
        <text x={shape.x} y={shape.y} fontSize={shape.size} textAnchor={shape.align ?? "start"} dominantBaseline="middle" style={style} {...tap}>
          {shape.text}
        </text>
      );
  }
}

export function Button({ part, context }: { part: ButtonPart<unknown>; context: PartContext }) {
  return (
    <button className="kit-button" type="button" disabled={part.disabled === true || context.onAction === undefined} onClick={() => context.onAction?.(part.action)}>
      {part.label}
    </button>
  );
}

export function TextInput({ part, context }: { part: TextInputPart<unknown>; context: PartContext }) {
  const [text, setText] = useState("");
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim() === "" || context.onAction === undefined) return;
    context.onAction({ ...part.action, text });
    setText("");
  };
  return (
    <form className="kit-text-input" onSubmit={send}>
      <input value={text} onChange={(event) => setText(event.target.value)} maxLength={part.maxLength ?? DEFAULT_TEXT_INPUT_LENGTH} placeholder={part.placeholder} enterKeyHint="send" />
      <button className="kit-button" type="submit" disabled={text.trim() === ""}>
        Send
      </button>
    </form>
  );
}

/** The pens a drawing pad offers when its Game names none. */
const SITE_PENS: readonly Hex[] = ["#000000", "#e63946", "#f4a261", "#2a9d8f", "#1d4ed8", "#7b2cbf"];
const PEN_WIDTH = 12;

export function DrawingPad({ part, context }: { part: DrawingPadPart<unknown>; context: PartContext }) {
  const pens = part.colors ?? SITE_PENS;
  const [pen, setPen] = useState<Hex>(pens[0] ?? "#000000");
  const ink = useRef(new Ink());
  // Redrawn from the Ink after each change: the Ink holds the truth.
  const [drawing, setDrawing] = useState<Drawing>({ strokes: [] });

  const at = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, size: box.width };
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = at(event);
    ink.current.start(p.x, p.y, p.size, pen, PEN_WIDTH);
    setDrawing(ink.current.drawing());
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (event.buttons === 0) return;
    const p = at(event);
    ink.current.move(p.x, p.y, p.size);
    setDrawing(ink.current.drawing());
  };
  const up = () => ink.current.end();
  const clear = () => {
    ink.current.clear();
    setDrawing(ink.current.drawing());
  };
  const send = () => {
    if (ink.current.isEmpty() || context.onAction === undefined) return;
    context.onAction({ ...part.action, drawing: ink.current.drawing() });
    clear();
  };

  return (
    <div className="kit-pad">
      <svg className="kit-pad-surface" viewBox={`0 0 ${DRAWING_SIZE} ${DRAWING_SIZE}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="drawing pad">
        <rect width={DRAWING_SIZE} height={DRAWING_SIZE} fill="var(--kit-surface)" />
        <Strokes drawing={drawing} />
      </svg>
      <div className="kit-pad-pens" role="radiogroup" aria-label="pen colour">
        {pens.map((color) => (
          <button key={color} type="button" role="radio" aria-checked={color === pen} aria-label={color} className="kit-pen" style={{ background: color }} onClick={() => setPen(color)} />
        ))}
      </div>
      <div className="kit-pad-actions">
        <button className="kit-button kit-button-quiet" type="button" onClick={clear}>
          Clear
        </button>
        <button className="kit-button" type="button" onClick={send} disabled={drawing.strokes.length === 0}>
          Send
        </button>
      </div>
    </div>
  );
}

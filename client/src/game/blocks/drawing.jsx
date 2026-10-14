// How drawings look (plan §12c): the same palette names as server/src/games/kit/drawing.js,
// on a 1000 × 750 canvas. Drawings always sit on white "paper", in light and dark mode,
// so a drawing looks the same on every screen.

export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 750;
export const MAX_POINTS = 1500;
export const PEN_WIDTH = 8;

export const COLORS = {
  black: '#1a1a2e',
  white: '#ffffff',
  gray: '#8d8d9b',
  red: '#e5383b',
  orange: '#f77f00',
  yellow: '#f7c948',
  green: '#2b9348',
  blue: '#277da1',
  purple: '#7b2cbf',
  pink: '#f472b6',
  brown: '#8b5a2b',
};

/** The SVG for a list of strokes (used by the drawing block and the drawPad). */
export function Strokes({ strokes }) {
  return strokes.map((stroke, i) => {
    const p = stroke.points;
    // One point is a dot: draw it as a line to itself (round caps make it a circle).
    const points = p.length === 2 ? `${p[0]},${p[1]} ${p[0]},${p[1]}` : pairs(p);
    return (
      <polyline
        key={i}
        points={points}
        fill="none"
        stroke={COLORS[stroke.color] ?? COLORS.black}
        strokeWidth={PEN_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  });
}

function pairs(p) {
  const out = [];
  for (let i = 0; i < p.length; i += 2) out.push(`${p[i]},${p[i + 1]}`);
  return out.join(' ');
}

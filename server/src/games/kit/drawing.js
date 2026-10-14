import { isPlainObject } from '../../protocol/validate.js';

// THE DRAWING FORMAT (plan §12c), shared by the drawPad widget (what a phone sends) and the
// drawing block (what a screen shows):
//
//   [{ color: 'red', points: [x1, y1, x2, y2, ...] }, ...]     strokes, in drawing order
//
// Coordinates are whole numbers on a 1000 × 750 canvas (4:3), whatever the phone's size.
// Colors are names from a fixed palette, so games and phones can't inject CSS.
// The limits keep one drawing around 10 KB, so a big screen can show a gallery of them.

export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 750;
export const PALETTE = ['black', 'white', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown'];
export const MAX_STROKES = 150;
export const MAX_POINTS = 1500; // x,y pairs, over all strokes

/**
 * @param {unknown} strokes
 * @returns {string | null}  what's wrong, or null
 */
export function checkStrokes(strokes) {
  if (!Array.isArray(strokes)) return 'must be a list of strokes';
  if (strokes.length > MAX_STROKES) return `has too many strokes (at most ${MAX_STROKES})`;
  let points = 0;
  for (const [i, stroke] of strokes.entries()) {
    if (!isPlainObject(stroke) || Object.keys(stroke).some((k) => k !== 'color' && k !== 'points')) {
      return `stroke ${i} must be { color, points }`;
    }
    if (!PALETTE.includes(stroke.color)) return `stroke ${i}: color must be one of ${PALETTE.join(', ')}`;
    const p = stroke.points;
    if (!Array.isArray(p) || p.length < 2 || p.length % 2 !== 0) return `stroke ${i}: points must be [x1, y1, x2, y2, ...]`;
    for (let j = 0; j < p.length; j += 2) {
      const [x, y] = [p[j], p[j + 1]];
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > CANVAS_WIDTH || y < 0 || y > CANVAS_HEIGHT) {
        return `stroke ${i}: points must be whole numbers, x 0–${CANVAS_WIDTH} and y 0–${CANVAS_HEIGHT}`;
      }
    }
    points += p.length / 2;
  }
  if (points > MAX_POINTS) return `has too many points (at most ${MAX_POINTS})`;
  return null;
}

/** A random scribble (for the test bots). */
export function botScribble(rand, colors = ['black']) {
  return Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({
    color: colors[Math.floor(rand() * colors.length)],
    points: Array.from({ length: 2 * (2 + Math.floor(rand() * 20)) }, (_, i) =>
      Math.floor(rand() * (i % 2 === 0 ? CANVAS_WIDTH : CANVAS_HEIGHT)),
    ),
  }));
}

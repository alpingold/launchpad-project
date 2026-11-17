/**
 * What a drawing pad records, kept apart from the pad's React code so it can be tested on its own.
 *
 * A pad on a phone is a few hundred pixels across; a Drawing lives in a 1000 by 1000 square, in whole
 * numbers (the SDK's Drawing rules). So every point is scaled and rounded, and a point that rounds to
 * the same place as the one before is skipped (a finger held still adds nothing). A Drawing holds at
 * most 200 strokes and 2,000 points: as it nears that, the strokes are thinned (every other point
 * kept), so the Player can go on drawing rather than being refused more ink.
 */
import type { Drawing, Hex, Stroke } from "@boilergames/sdk/v1";
import { DRAWING_SIZE, MAX_DRAWING_POINTS, MAX_STROKES } from "@boilergames/sdk/v1/check";

/** When the points in all reach this, the strokes are thinned, leaving room to go on. */
const THIN_AT = MAX_DRAWING_POINTS - 50;

interface Line {
  readonly color: Hex;
  readonly width: number;
  /** Flat [x0, y0, x1, y1, ...], whole numbers in the 1000-square. */
  points: number[];
}

export class Ink {
  #lines: Line[] = [];
  #drawing = false;

  /** Starts a stroke at (x, y) on a pad `size` pixels across. Ignored once the Drawing holds the most strokes. */
  start(x: number, y: number, size: number, color: Hex, width: number): void {
    if (this.#lines.length >= MAX_STROKES) {
      this.#drawing = false;
      return;
    }
    this.#lines.push({ color, width, points: [] });
    this.#drawing = true;
    this.move(x, y, size);
  }

  /** Adds (x, y) to the stroke being drawn. */
  move(x: number, y: number, size: number): void {
    const line = this.#lines.at(-1);
    if (!this.#drawing || line === undefined) return;
    const px = scale(x, size);
    const py = scale(y, size);
    const n = line.points.length;
    if (n >= 2 && line.points[n - 2] === px && line.points[n - 1] === py) return;
    line.points.push(px, py);
    if (this.pointCount() >= THIN_AT) this.#thin();
  }

  end(): void {
    this.#drawing = false;
  }

  clear(): void {
    this.#lines = [];
    this.#drawing = false;
  }

  /** How many points (x, y pairs) the Drawing holds in all. */
  pointCount(): number {
    return this.#lines.reduce((sum, line) => sum + line.points.length / 2, 0);
  }

  isEmpty(): boolean {
    return this.#lines.every((line) => line.points.length === 0);
  }

  /** The Drawing as a Game receives it. */
  drawing(): Drawing {
    const strokes: Stroke[] = this.#lines.filter((line) => line.points.length > 0).map((line) => ({ color: line.color, width: line.width, points: [...line.points] }));
    return { strokes };
  }

  /** Keeps every other point of each stroke, always its first and last, so its shape survives. */
  #thin(): void {
    for (const line of this.#lines) {
      const count = line.points.length / 2;
      if (count <= 2) continue;
      const kept: number[] = [];
      for (let i = 0; i < count; i++) if (i % 2 === 0 || i === count - 1) kept.push(line.points[2 * i]!, line.points[2 * i + 1]!);
      line.points = kept;
    }
  }
}

/** A pixel position on a pad `size` pixels across, as a whole number in the 1000-square. */
function scale(pixels: number, size: number): number {
  const scaled = Math.round((pixels / Math.max(1, size)) * DRAWING_SIZE);
  return Math.min(DRAWING_SIZE, Math.max(0, scaled));
}

/**
 * The Screen's View, fitted to the TV. The site does this, not the Game: a Game can't know whether it
 * is on a 720p projector or a 4K TV, and it shouldn't have to.
 *
 * The View is laid out on a stage of fixed width (STAGE_WIDTH stage pixels), as tall as it needs.
 * The stage is then scaled so the whole View fits the space it is given, and centred in it: a
 * crowded View shrinks until nothing is cut off, and a sparse one grows, up to MAX_SCALE so three
 * words don't fill a 4K TV. The Look's background fills the whole space, not only the stage.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** The stage's width in stage pixels: what Screen Views are laid out for. */
export const STAGE_WIDTH = 1280;
/** The most a View is enlarged. */
export const MAX_SCALE = 2;

export function ScreenStage({ background, children }: { background: string; children: ReactNode }) {
  const space = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, left: 0, top: 0 });

  useLayoutEffect(() => {
    const outer = space.current;
    const inner = stage.current;
    if (outer === null || inner === null) return;
    const measure = () => {
      // offsetHeight is the stage's own height, unaffected by its scale.
      const height = Math.max(1, inner.offsetHeight);
      const scale = Math.min(outer.clientWidth / STAGE_WIDTH, outer.clientHeight / height, MAX_SCALE);
      setFit({ scale, left: (outer.clientWidth - STAGE_WIDTH * scale) / 2, top: (outer.clientHeight - height * scale) / 2 });
    };
    const watch = new ResizeObserver(measure);
    watch.observe(outer);
    watch.observe(inner);
    measure();
    return () => watch.disconnect();
  }, []);

  return (
    <div ref={space} className="screen-stage-space" style={{ background }}>
      <div
        ref={stage}
        className="screen-stage"
        data-scale={fit.scale}
        style={{ width: STAGE_WIDTH, transform: `translate(${fit.left}px, ${fit.top}px) scale(${fit.scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

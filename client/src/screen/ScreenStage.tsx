/**
 * The Screen's View, fitted to the TV. The site does this, not the Game: a Game can't know whether it
 * is on a 720p projector or a 4K TV, and it shouldn't have to.
 *
 * The View is laid out on a stage of fixed width (STAGE_WIDTH stage pixels), as tall as it needs.
 * The stage is then scaled so the whole View fits the space it is given, and centred in it: a
 * crowded View shrinks until nothing is cut off, and a sparse one grows, up to MAX_SCALE so three
 * words don't fill a 4K TV. The Look's background fills the whole space, not only the stage.
 *
 * A drawing or a picture is what everyone is looking at, so it gives up space last. When the View
 * has one (not inside a row, where the Game already put something beside it), the stage also tries
 * it "beside": the picture in a left column and everything else to its right, using the TV's width
 * rather than its height. "Beside" is kept when it shows the picture bigger without making anything
 * else smaller, so the lists give up their place below the picture, not their text size.
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
    /** The fit for the stage as it is laid out now, and how tall its picture would be on the TV. */
    const fitNow = () => {
      // offsetHeight is the stage's own height, unaffected by its scale.
      const height = Math.max(1, inner.offsetHeight);
      const scale = Math.min(outer.clientWidth / STAGE_WIDTH, outer.clientHeight / height, MAX_SCALE);
      const picture = inner.querySelector(":scope > .kit-view > .kit-drawing svg, :scope > .kit-view > .kit-picture");
      const current = Number(inner.dataset["scale"] ?? "1") || 1;
      const pictureHeight = picture === null ? 0 : (picture.getBoundingClientRect().height / current) * scale;
      return { height, scale, pictureHeight };
    };
    const measure = () => {
      const view = inner.firstElementChild as HTMLElement | null;
      view?.removeAttribute("data-layout");
      let best = fitNow();
      if (view !== null && best.pictureHeight > 0) {
        view.setAttribute("data-layout", "beside");
        const beside = fitNow();
        // Kept only if the picture is bigger and nothing else gets smaller: its text must stay as readable.
        if (beside.pictureHeight > best.pictureHeight && beside.scale >= best.scale) best = beside;
        else view.removeAttribute("data-layout");
      }
      setFit({ scale: best.scale, left: (outer.clientWidth - STAGE_WIDTH * best.scale) / 2, top: (outer.clientHeight - best.height * best.scale) / 2 });
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

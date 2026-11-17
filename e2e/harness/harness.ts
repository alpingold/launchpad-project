// The test Screen: a bare page on the site's origin that drives one GameFrame at a time, for the
// Playwright tests to call through `window.harness`. It is the real GameFrame; only the page is a stand-in.
import { GameFrame, type FrameResult } from "../../client/src/screen/game-frame.js";

const frameUrl = new URLSearchParams(location.search).get("frame");
if (frameUrl === null) throw new Error("open the harness with ?frame=<the frame's URL>");

export interface Harness {
  /** Every result the current frame has given, in order. */
  results: FrameResult[];
  frame: GameFrame | undefined;
  /** A built test bundle from this origin, as text, the way the Screen fetches a Game. */
  bundle(name: string): Promise<string>;
  /**
   * Replaces the current frame (if any) with a fresh one. With `alongside`, keeps the others, so two
   * Games run side by side on the page, as two Rooms' Screens could in two tabs.
   */
  create(alongside?: boolean): GameFrame;
  /** A GameFrame on the stand-in frame page (public/fake-frame.html), doing what `mode` says. */
  createFake(mode: string): GameFrame;
  /** Removes every frame. */
  destroyAll(): void;
  /** How many iframes the page holds now. */
  iframes(): number;
}

const frames: GameFrame[] = [];

const harness: Harness = {
  results: [],
  frame: undefined,
  async bundle(name) {
    const response = await fetch(`/games/${name}.js`);
    if (!response.ok) throw new Error(`no bundle ${name}`);
    return response.text();
  },
  create(alongside = false) {
    if (!alongside) harness.destroyAll();
    harness.results = [];
    const results = harness.results;
    harness.frame = new GameFrame({ frameUrl, container: document.body, onResult: (result) => results.push(result) });
    frames.push(harness.frame);
    return harness.frame;
  },
  createFake(mode) {
    harness.destroyAll();
    harness.frame = new GameFrame({ frameUrl: `/fake-frame.html?mode=${mode}`, container: document.body, onResult: () => undefined });
    frames.push(harness.frame);
    return harness.frame;
  },
  destroyAll() {
    for (const frame of frames.splice(0)) frame.destroy();
  },
  iframes: () => document.querySelectorAll("iframe").length,
};

(window as unknown as { harness: Harness }).harness = harness;
document.body.dataset["ready"] = "yes";

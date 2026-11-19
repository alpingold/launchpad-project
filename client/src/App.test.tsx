import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { App } from "./App.js";

test("the page names the site", () => {
  expect(renderToString(<App />)).toContain("BoilerGames");
});

// The Screen and the phone need a browser to draw anything: the browser test finds their feet.
test("every page links to the privacy page at its foot", () => {
  for (const path of ["/", "/library", "/library/x", "/my/games", "/my/games/x", "/make", "/sign-in", "/sign-in/confirm", "/sign-in/name", "/privacy"]) {
    expect(renderToString(<App path={path} />), path).toContain('href="/privacy"');
  }
});

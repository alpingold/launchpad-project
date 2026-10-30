import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { App } from "./App.js";

test("the page names the site", () => {
  expect(renderToString(<App />)).toContain("BoilerGames");
});

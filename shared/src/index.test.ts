import { expect, test } from "vitest";
import { siteName } from "./index.js";

test("shared names the site", () => {
  expect(siteName).toBe("BoilerGames");
});

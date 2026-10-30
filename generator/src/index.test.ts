import { expect, test } from "vitest";
import { targetSdkVersion } from "./index.js";

test("the generator writes Games for the current SDK", () => {
  expect(targetSdkVersion).toBe("0.0.0");
});

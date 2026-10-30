import { expect, test } from "vitest";
import { sdkVersion } from "./index.js";

test("the SDK has a version for Games to record", () => {
  expect(sdkVersion).toBe("0.0.0");
});

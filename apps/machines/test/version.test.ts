import { expect, test } from "bun:test";
import { getPackageVersion } from "../src/version.js";

test("reads package version", () => {
  expect(getPackageVersion()).toBe("0.0.1");
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getPackageVersion } from "../src/version.js";

test("reads package version", () => {
  const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
  expect(getPackageVersion()).toBe(version);
});

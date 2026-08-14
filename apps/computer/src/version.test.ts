import { expect, test } from "bun:test";
import packageJson from "../package.json";
import { VERSION } from "./version.js";

test("exported runtime version matches package version", () => {
  expect(VERSION).toBe(packageJson.version);
});

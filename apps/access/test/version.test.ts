import { describe, expect, it } from "bun:test";
import packageJson from "../package.json";
import { APP_VERSION } from "../src/version.js";

describe("version", () => {
  it("APP_VERSION matches package.json", () => {
    expect(APP_VERSION).toBe(packageJson.version);
  });
});

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_VERSION } from "../src/version.js";

describe("version", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dir, "..", "package.json"), "utf8")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });
});

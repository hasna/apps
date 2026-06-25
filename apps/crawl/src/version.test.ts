import { describe, expect, it } from "bun:test";
import { PACKAGE_VERSION } from "./version";

describe("package version metadata", () => {
  it("matches package.json", async () => {
    const packageJson = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
      version: string;
    };

    expect(PACKAGE_VERSION).toBe(packageJson.version);
  });
});

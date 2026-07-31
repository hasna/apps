import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("package CLI binaries", () => {
  test("exposes only the canonical markdown commands", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      bin: Record<string, string>;
    };

    expect(pkg.bin).toEqual({
      markdown: "dist/cli/index.js",
      "markdown-mcp": "dist/mcp/index.js",
      "markdown-serve": "dist/server/index.js",
    });
  });
});

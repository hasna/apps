import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("SDK browser bundle boundary", () => {
  it("does not import the connector runtime from the hosted SDK entrypoint", () => {
    const source = readFileSync(join(import.meta.dir, "index.ts"), "utf8");

    expect(source).not.toMatch(/from\s+["']@hasna\/connectors["']/);
    expect(source).not.toMatch(/from\s+["'](?:\.\.\/)?connectors\//);
    expect(source).not.toMatch(/from\s+["']\.\.\/src\//);
    expect(source).not.toMatch(/import\(["']@hasna\/connectors["']\)/);
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const contract = JSON.parse(readFileSync(join(root, "hasna.contract.json"), "utf8"));

describe("Instructions storage and release package contract", () => {
  test("publishes the native storage SDK and builds it", () => {
    expect(pkg.exports["./storage"]).toEqual({ types: "./dist/storage/index.d.ts", import: "./dist/storage/index.js" });
    expect(pkg.scripts.build).toContain("src/storage/index.ts");
    expect(pkg.files).toContain("hasna.contract.json");
  });

  test("declares compatibility bins, live PostgreSQL proof, and packed-artifact scanning", () => {
    expect(contract.bins).toEqual(expect.arrayContaining(["instructions", "instructions-mcp", "instructions-serve", "configs", "configs-mcp"]));
    expect(contract.storage.pgTestGate).toEqual({ envVar: "HASNA_INSTRUCTIONS_TEST_DATABASE_URL", command: "bun run test:postgres" });
    expect(contract.metadata.release.artifactScan.script).toBe("scan:artifact");
    expect(pkg.scripts.prepack).toContain("scan:artifact");
  });
});

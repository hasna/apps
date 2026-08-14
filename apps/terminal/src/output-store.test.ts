import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("output store manifests", () => {
  it("stores compact task evidence with a lossless raw ref", async () => {
    process.env.HASNA_TERMINAL_DIR = mkdtempSync(join(tmpdir(), "terminal-store-"));
    const { saveOutputManifest } = await import("./output-store.js");
    const raw = Array.from({ length: 8 }, (_, i) => `src/file-${i}.test.ts:${i + 1}:describe("case")`).join("\n");
    const manifestPath = saveOutputManifest('rg -n "describe" src', raw);
    expect(manifestPath).toBeTruthy();

    const manifest = readFileSync(manifestPath ?? "", "utf8");
    const rawRef = manifest.match(/^raw-ref:\s*(.+)$/m)?.[1];
    expect(manifest).toContain("search refs: 8 matches");
    expect(rawRef).toBeTruthy();
    expect(existsSync(rawRef ?? "")).toBe(true);
    expect(readFileSync(rawRef ?? "", "utf8")).toContain("describe");
  });
});

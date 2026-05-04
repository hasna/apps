import { describe, expect, it } from "bun:test";
import { buildFileManifest, buildSearchManifest } from "./output-manifest.js";
import { estimateTokens } from "./tokens.js";

describe("output manifest", () => {
  it("groups search matches by file while keeping every match address", () => {
    const output = Array.from({ length: 40 }, (_, i) => `src/file-${i % 4}.test.ts:${i + 1}:describe("case ${i}", () => {})`).join("\n");
    const manifest = buildSearchManifest('rg -n "describe" src', output);
    expect(manifest?.content).toContain("40 matches in 4 files");
    expect(manifest?.content).toContain("src/file-0.test.ts");
    expect(manifest?.content).toContain("src/file-0.test.ts:1");
    expect(manifest?.content).not.toContain("describe(\"case");
    expect(estimateTokens(manifest?.content ?? "")).toBeLessThan(estimateTokens(output));
  });

  it("groups file lists by area while preserving paths", () => {
    const output = [
      "src/cli/index.ts",
      "src/cli/run.ts",
      "src/lib/a.ts",
      "src/lib/b.ts",
      "src/lib/c.ts",
      "src/mcp/server.ts",
      "src/mcp/tools.ts",
    ].join("\n");
    const manifest = buildFileManifest("find src -maxdepth 2 -type f", output);
    expect(manifest?.content).toContain("7 files in 3 groups");
    expect(manifest?.content).toContain("src/cli/*.ts{index,run}");
    expect(manifest?.content).toContain("src/mcp/*.ts{server,tools}");
  });

  it("does not treat git status porcelain as a file listing manifest", () => {
    const output = [
      " M src/cli.tsx",
      " M src/output-store.ts",
      "?? src/output-manifest.ts",
      "?? src/output-manifest.test.ts",
      " M README.md",
      " M package.json",
    ].join("\n");
    expect(buildFileManifest("git status --short --branch", output)).toBeNull();
  });
});

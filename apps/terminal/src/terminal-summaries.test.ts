import { describe, expect, it } from "bun:test";
import {
  formatProjectOverview,
  summarizeFileListing,
  summarizeGitShortStatus,
  summarizeSearchOutput,
} from "./terminal-summaries.js";
import { estimateTokens } from "./tokens.js";

describe("terminal summaries", () => {
  it("compacts large git status output while preserving counts", () => {
    const output = [
      "## main...origin/main",
      ...Array.from({ length: 100 }, (_, i) => ` M src/file-${i}.ts`),
      "?? src/new-file.ts",
    ].join("\n");

    const summary = summarizeGitShortStatus(output);
    expect(summary).toContain("Branch: main");
    expect(summary).toContain("101 changed");
    expect(summary).toContain("100 modified");
    expect(summary).toContain("1 untracked");
    expect(summary).not.toContain("Sample:");
    expect(estimateTokens(summary ?? "")).toBeLessThan(estimateTokens(output) * 0.1);
  });

  it("summarizes ripgrep matches without claiming no results", () => {
    const output = Array.from({ length: 50 }, (_, i) => `src/file-${i % 5}.test.ts:${i + 1}:describe("case ${i}", () => {})`).join("\n");
    const summary = summarizeSearchOutput(output);
    expect(summary).toContain("50 matches in 5 files");
    expect(summary).toContain("Top:");
    expect(summary).not.toContain("Samples:");
    expect(estimateTokens(summary ?? "")).toBeLessThan(estimateTokens(output) * 0.25);
  });

  it("summarizes file listings by area", () => {
    const output = [
      "src/cli/index.ts",
      "src/cli/run.ts",
      "src/lib/a.ts",
      "src/lib/b.ts",
      "src/mcp/server.ts",
      "src/mcp/tools.ts",
      "src/index.ts",
    ].join("\n");
    const summary = summarizeFileListing(output);
    expect(summary).toContain("7 files");
    expect(summary).toContain("src/cli x2");
  });

  it("formats project overview as names instead of full script bodies", () => {
    const summary = formatProjectOverview(
      {
        name: "@hasna/brands",
        version: "0.0.1",
        scripts: { build: "tsc", "dev:cli": "tsx src/cli/index.ts", typecheck: "tsc --noEmit" },
        dependencies: { chalk: "^5", commander: "^14" },
      },
      ["cli", "db", "index.ts"],
    );
    expect(summary).toBe("@hasna/brands@0.0.1\nScripts (3): build, dev:cli, typecheck\nDeps (2): chalk, commander\nSource (3): cli, db, index.ts");
  });
});

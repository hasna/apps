import { describe, expect, it } from "bun:test";

describe("CLI docs", () => {
  it("prints the built-in usage guide", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "src/index.ts", "docs"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("secrets docs");
    expect(stdout).toContain("Common CLI workflows");
    expect(stdout).toContain("MCP tools");
    expect(stdout).toContain("Agents connect over stdio by running:");
    expect(stdout).toContain("secrets mcp");
    expect(stdout).toContain("secrets mcp http --port 8848");
    expect(stdout).toContain("secrets import-env --dir ~/.secrets --dry-run");
    expect(stdout).toContain("secrets export");
    expect(stdout).toContain("secrets scan workspace --limit 50");
  });
});

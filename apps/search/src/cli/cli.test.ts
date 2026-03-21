import { describe, it, expect } from "bun:test";

describe("CLI", () => {
  it("should show help with --help", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SEARCH_DB_PATH: ":memory:" },
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    expect(output).toContain("Unified search aggregator");
    expect(output).toContain("query");
    expect(output).toContain("history");
    expect(output).toContain("providers");
    expect(output).toContain("profiles");
  });

  it("should show version with --version", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SEARCH_DB_PATH: ":memory:" },
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    expect(output.trim()).toBe("0.0.1");
  });

  it("should list providers", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", "providers", "list"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SEARCH_DB_PATH: ":memory:" },
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    expect(output).toContain("google");
    expect(output).toContain("arxiv");
    expect(output).toContain("hackernews");
  });

  it("should list profiles", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", "profiles", "list"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SEARCH_DB_PATH: ":memory:" },
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    expect(output).toContain("research");
    expect(output).toContain("social");
    expect(output).toContain("code");
  });

  it("should show config", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", "config", "get"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SEARCH_DB_PATH: ":memory:" },
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const config = JSON.parse(output);
    expect(config.defaultLimit).toBe(10);
    expect(config.dedup).toBe(true);
  });

  it("should show stats", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", "stats"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SEARCH_DB_PATH: ":memory:" },
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    expect(output).toContain("Search Statistics");
    expect(output).toContain("Total searches");
  });
});

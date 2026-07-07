import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json";
import { closeDb } from "../db/database.js";
import { createSearch } from "../db/searches.js";

async function runCli(args: string[], dbPath: string): Promise<string> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, SEARCH_DB_PATH: dbPath },
  });
  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  expect(stderr).toBe("");
  expect(proc.exitCode).toBe(0);
  return output;
}

function withTempDb<T>(fn: (dbPath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "search-cli-"));
  const dbPath = join(dir, "data.db");
  const previous = process.env["SEARCH_DB_PATH"];

  process.env["SEARCH_DB_PATH"] = dbPath;
  closeDb();

  return fn(dbPath).finally(() => {
    closeDb();
    if (previous === undefined) delete process.env["SEARCH_DB_PATH"];
    else process.env["SEARCH_DB_PATH"] = previous;
    rmSync(dir, { recursive: true, force: true });
  });
}

describe("CLI", () => {
  it("should show help with --help", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SEARCH_DB_PATH: ":memory:" },
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    expect(output).toContain("Unified search");
    expect(output).toContain("query");
    expect(output).toContain("find");
    expect(output).toContain("index");
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
    expect(output.trim()).toBe(pkg.version);
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

  it("keeps history list compact by default while preserving JSON and verbose detail", async () => {
    await withTempDb(async (dbPath) => {
      const longQuery = `token bloat query ${"very-long-fragment ".repeat(20)}full-tail`;
      for (let i = 0; i < 25; i++) {
        createSearch({
          query: `${longQuery} ${i}`,
          providers: ["google"],
          resultCount: 42,
          duration: 120,
        });
      }
      closeDb();

      const compact = await runCli(["history", "list"], dbPath);
      expect(compact).toContain("Search History (showing 20 of 25)");
      expect(compact).toContain("details: search history show <id> --verbose");
      expect(compact).toContain("more: search history list --offset 20");
      expect(compact).not.toContain("full-tail 24");

      const verbose = await runCli(["history", "list", "--limit", "1", "--verbose"], dbPath);
      expect(verbose).toContain("full-tail");

      const jsonOutput = await runCli(["history", "list", "--limit", "1", "--json"], dbPath);
      const parsed = JSON.parse(jsonOutput) as { total: number; searches: Array<{ query: string }> };
      expect(parsed.total).toBe(25);
      expect(parsed.searches[0]?.query).toContain("full-tail");
    });
  });
});

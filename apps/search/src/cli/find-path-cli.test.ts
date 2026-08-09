import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], env: Record<string, string>): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return { stdout, stderr, exitCode: proc.exitCode ?? 0 };
}

function testEnv(dir: string): Record<string, string> {
  const indexDbPath = join(dir, "index.db");
  return {
    SEARCH_DB_PATH: join(dir, "data.db"),
    SEARCH_INDEX_DB_PATH: indexDbPath,
    HASNA_SEARCH_INDEX_DB_PATH: indexDbPath,
  };
}

describe("search find --path", () => {
  test("advertises the option on the command that accepts it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-find-path-help-"));
    try {
      const result = await runCli(["find", "--help"], testEnv(dir));

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("-p, --path <path>");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("accepts the documented option without hiding an unconfigured index", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-find-path-empty-"));
    try {
      const result = await runCli(["find", "executor", "--path", dir, "--json", "--no-refresh"], testEnv(dir));

      expect(result.stderr).toBe("");
      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        indexed: false,
        roots: 0,
        total: 0,
        results: [],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("limits results and reported root health to the requested indexed path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-find-path-scope-"));
    const positiveRoot = join(dir, "positive");
    const negativeRoot = join(dir, "negative");
    mkdirSync(positiveRoot, { recursive: true });
    mkdirSync(negativeRoot, { recursive: true });
    writeFileSync(join(positiveRoot, "executor-positive.txt"), "executor lives here\n");
    writeFileSync(join(negativeRoot, "unrelated.txt"), "nothing relevant\n");
    const env = testEnv(dir);

    try {
      const positiveAdded = await runCli(["index", "add", positiveRoot, "--json"], env);
      const negativeAdded = await runCli(["index", "add", negativeRoot, "--json"], env);
      expect(positiveAdded.exitCode).toBe(0);
      expect(negativeAdded.exitCode).toBe(0);

      const positive = await runCli(
        ["find", "executor", "--path", positiveRoot, "--json", "--no-refresh"],
        env,
      );
      expect(positive.stderr).toBe("");
      expect(positive.exitCode).toBe(0);
      const positivePayload = JSON.parse(positive.stdout);
      expect(positivePayload.indexed).toBe(true);
      expect(positivePayload.roots).toBe(1);
      expect(positivePayload.rootHealth).toEqual([
        expect.objectContaining({ path: positiveRoot, health: "ready" }),
      ]);
      expect(positivePayload.results).toHaveLength(1);
      expect(positivePayload.results[0].path).toBe(join(positiveRoot, "executor-positive.txt"));

      const negative = await runCli(
        ["find", "executor", "--path", negativeRoot, "--json", "--no-refresh"],
        env,
      );
      expect(negative.stderr).toBe("");
      expect(negative.exitCode).toBe(0);
      const negativePayload = JSON.parse(negative.stdout);
      expect(negativePayload.indexed).toBe(true);
      expect(negativePayload.roots).toBe(1);
      expect(negativePayload.rootHealth).toEqual([
        expect.objectContaining({ path: negativeRoot, health: "ready" }),
      ]);
      expect(negativePayload.total).toBe(0);
      expect(negativePayload.results).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

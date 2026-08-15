/**
 * CLI-level regression tests for the wedged-index silent failure.
 *
 * The library-level contract is covered in src/lib/local/wedged-index.test.ts.
 * These tests pin the part that actually bit the fleet: `search find --json`
 * exited 0 with `"results": []` against a wedged index, which every scripted
 * consumer reads as "no matches exist".
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

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

/** Build a temp workspace + its own index db, index it, then wedge the root. */
async function withWedgedIndex(
  fn: (env: Record<string, string>, indexDbPath: string) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "search-wedged-cli-"));
  const workspace = join(dir, "workspace");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "a.ts"), "const alumia = 1;\n");

  const env = {
    SEARCH_DB_PATH: join(dir, "data.db"),
    SEARCH_INDEX_DB_PATH: join(dir, "index.db"),
    HASNA_SEARCH_INDEX_DB_PATH: join(dir, "index.db"),
  };

  try {
    const added = await runCli(["index", "add", workspace, "--json"], env);
    expect(added.exitCode).toBe(0);

    // Positive control: the term IS findable before we wedge anything.
    const before = await runCli(["find", "alumia", "-k", "content", "--json"], env);
    expect(before.exitCode).toBe(0);
    expect(JSON.parse(before.stdout).total).toBeGreaterThan(0);

    // Simulate a process killed mid-index.
    const db = new Database(env.SEARCH_INDEX_DB_PATH);
    db.exec(
      "UPDATE index_roots SET status = 'indexing', indexing_started_at = NULL, last_indexed_at = '2026-06-12T14:05:50.293Z'",
    );
    db.close();

    await fn(env, env.SEARCH_INDEX_DB_PATH);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("search find against a wedged index", () => {
  test("--json exits non-zero instead of returning a silent empty set", async () => {
    await withWedgedIndex(async (env) => {
      const res = await runCli(["find", "alumia", "-k", "content", "--json", "--no-refresh"], env);

      // This is the defect: it used to be exit 0 with results: [].
      expect(res.exitCode).not.toBe(0);

      const payload = JSON.parse(res.stdout);
      expect(payload.indexed).toBe(false);
      expect(payload.total).toBe(0);
      // An empty result set must carry its reason in the payload too, because
      // callers that ignore exit codes still parse the JSON.
      expect(payload.error).toBeTruthy();
    });
  }, 60_000);

  test("text mode warns on stderr, not stdout, and exits non-zero", async () => {
    await withWedgedIndex(async (env) => {
      const res = await runCli(["find", "alumia", "-k", "content", "--no-refresh"], env);

      expect(res.exitCode).not.toBe(0);
      // `search find ... | grep foo` must not swallow the warning into the pipe.
      expect(res.stderr).toContain("index");
      expect(res.stdout).toBe("");
    });
  }, 60_000);
});

describe("search index status against a wedged index", () => {
  test("does not report a dead run as 'indexing'", async () => {
    await withWedgedIndex(async (env) => {
      const res = await runCli(["index", "status", "--json"], env);
      const roots = JSON.parse(res.stdout);
      expect(roots.length).toBe(1);
      expect(roots[0].health).toBe("wedged");
    });
  }, 60_000);

  test("exits non-zero when a root is unhealthy", async () => {
    await withWedgedIndex(async (env) => {
      const res = await runCli(["index", "status", "--json"], env);
      expect(res.exitCode).not.toBe(0);
    });
  }, 60_000);
});

describe("the documented remedy actually works", () => {
  // The error message tells the operator to run `search index update`. If that
  // command did not in fact clear the wedge, the message would be the same
  // class of lie as the empty result set it replaced.
  test("`index update` recovers a wedged root and restores query results", async () => {
    await withWedgedIndex(async (env) => {
      const update = await runCli(["index", "update", "--json"], env);
      expect(update.exitCode).toBe(0);

      const status = await runCli(["index", "status", "--json"], env);
      expect(status.exitCode).toBe(0);
      expect(JSON.parse(status.stdout)[0].health).toBe("ready");

      const find = await runCli(["find", "alumia", "-k", "content", "--json"], env);
      expect(find.exitCode).toBe(0);
      expect(JSON.parse(find.stdout).total).toBeGreaterThan(0);
    });
  }, 60_000);
});

describe("positive control", () => {
  test("index status exits 0 and reports 'ready' for a healthy index", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-healthy-cli-"));
    const workspace = join(dir, "workspace");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "a.ts"), "const alumia = 1;\n");
    const env = {
      SEARCH_DB_PATH: join(dir, "data.db"),
      SEARCH_INDEX_DB_PATH: join(dir, "index.db"),
      HASNA_SEARCH_INDEX_DB_PATH: join(dir, "index.db"),
    };
    try {
      await runCli(["index", "add", workspace, "--json"], env);
      const res = await runCli(["index", "status", "--json"], env);
      expect(res.exitCode).toBe(0);
      expect(JSON.parse(res.stdout)[0].health).toBe("ready");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = new URL("./cli/index.tsx", import.meta.url).pathname;
const STORAGE_PATH = new URL("./storage.ts", import.meta.url).pathname;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "mementos-startup-lock-"));
  const dbPath = join(home, "owned.db");
  const tracePath = join(home, "pragma.jsonl");
  const observerPath = join(home, "observe.ts");
  // Observe the real native call without replacing its result or lock semantics.
  // Start the release timer when the child reaches WAL setup, so transpilation
  // time cannot accidentally turn the regression into a pass.
  writeFileSync(observerPath, `
    import { Database } from "bun:sqlite";
    import { appendFileSync } from "node:fs";
    const exec = Database.prototype.exec;
    Database.prototype.exec = function(sql, ...args) {
      if (/^PRAGMA (?:journal_mode|busy_timeout)/i.test(sql)) {
        appendFileSync(process.env.PROBE_TRACE, JSON.stringify({ sql, at: Date.now() }) + "\\n");
      }
      return exec.call(this, sql, ...args);
    };
  `);
  const env = {
    HOME: home, TMPDIR: home, PATH: "/usr/bin:/bin", NO_COLOR: "1",
    HASNA_MEMENTOS_DB_PATH: dbPath, MEMENTOS_DB_PATH: dbPath, PROBE_TRACE: tracePath,
  };
  const children: ReturnType<typeof Bun.spawn>[] = [];
  let lock: Database | undefined;
  function spawn(args: string[], observe = false) {
    const child = Bun.spawn([
      process.execPath, "run", "--no-env-file",
      ...(observe ? ["--preload", observerPath] : []), ...args,
    ], { cwd: home, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    children.push(child);
    const deadline = setTimeout(() => child.kill("SIGKILL"), 20_000);
    const result = Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]).then(([exitCode, stdout, stderr]) => ({ exitCode, stdout, stderr }))
      .finally(() => clearTimeout(deadline));
    return { child, result };
  }
  const cli = (json: boolean, observe = false) => spawn([
    CLI_PATH, ...(json ? ["--json"] : []), "list", "--limit", "1",
  ], observe);
  async function initialize(mode: "DELETE" | "WAL") {
    const initial = await cli(true).result;
    expect(initial.exitCode).toBe(0);
    expect(JSON.parse(initial.stdout)).toEqual([]);
    const db = new Database(dbPath);
    try {
      expect(db.query(`PRAGMA journal_mode = ${mode}`).get()).toEqual({ journal_mode: mode.toLowerCase() });
    } finally { db.close(); }
  }
  function hold() {
    lock = new Database(dbPath);
    lock.exec("BEGIN EXCLUSIVE");
  }
  function release() {
    if (lock) {
      lock.exec("ROLLBACK");
      lock.close();
      lock = undefined;
    }
  }
  function trace(): Array<{ sql: string; at: number }> {
    return existsSync(tracePath)
      ? readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
      : [];
  }
  async function reachedWal() {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const events = trace();
      if (events.some(({ sql }) => sql === "PRAGMA journal_mode = WAL")) return events;
      await delay(10);
    }
    throw new Error("Owned CLI never reached its real WAL pragma within 10 seconds");
  }
  async function cleanup() {
    release();
    for (const child of children) {
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
    }
    rmSync(home, { recursive: true, force: true });
  }
  return { home, cli, spawn, initialize, hold, release, trace, reachedWal, cleanup };
}

describe("SQLite startup busy timeout", () => {
  for (const json of [true, false]) {
    test(`actual ${json ? "JSON" : "human"} CLI waits for a released startup lock`, async () => {
      const f = fixture();
      try {
        await f.initialize("DELETE");
        f.hold();
        const run = f.cli(json, true);
        await f.reachedWal();
        await delay(300);
        expect(run.child.exitCode).toBeNull();
        f.release();
        const result = await run.result;
        expect(result.exitCode).toBe(0);
        expect(result.stdout + result.stderr).not.toContain("database is locked");
        if (json) expect(JSON.parse(result.stdout)).toEqual([]);
        else expect(result.stdout).toContain("No memories found");
        expect(f.trace().slice(0, 2).map(({ sql }) => sql)).toEqual([
          "PRAGMA busy_timeout = 5000", "PRAGMA journal_mode = WAL",
        ]);
      } finally { await f.cleanup(); }
    }, 30_000);
  }

  test("an ordinary WAL writer does not block actual CLI reads", async () => {
    const f = fixture();
    try {
      await f.initialize("WAL");
      f.hold();
      const result = await f.cli(true).result;
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([]);
      // The writer remains locked through successful child completion.
      f.release();
    } finally { await f.cleanup(); }
  }, 30_000);

  test("a persistent startup lock is refused after the existing five-second budget", async () => {
    const f = fixture();
    try {
      await f.initialize("DELETE");
      f.hold();
      const probe = join(f.home, "open.ts");
      writeFileSync(probe, `
        import { SqliteAdapter } from ${JSON.stringify(STORAGE_PATH)};
        const start = performance.now();
        try {
          const db = new SqliteAdapter(process.env.HASNA_MEMENTOS_DB_PATH);
          db.close();
          console.log(JSON.stringify({ opened: true }));
        } catch (error) {
          console.log(JSON.stringify({ code: error.code, elapsedMs: performance.now() - start }));
          process.exitCode = 1;
        }
      `);
      const result = await f.spawn([probe], true).result;
      expect(result.exitCode).toBe(1);
      const diagnostic = JSON.parse(result.stdout);
      expect(diagnostic.code).toBe("SQLITE_BUSY");
      expect(diagnostic.elapsedMs).toBeGreaterThanOrEqual(4_800);
      expect(diagnostic.elapsedMs).toBeLessThan(8_000);
      expect(f.trace().map(({ sql }) => sql)).toEqual([
        "PRAGMA busy_timeout = 5000", "PRAGMA journal_mode = WAL",
      ]);
      f.release();
      const recovered = await f.cli(true).result;
      expect(recovered.exitCode).toBe(0);
      expect(JSON.parse(recovered.stdout)).toEqual([]);
    } finally { await f.cleanup(); }
  }, 30_000);
});

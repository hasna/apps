import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb } from "../db/database.js";
import { upsertRepo } from "../db/repos.js";

const roots: string[] = [];
afterEach(() => {
  closeDb();
  delete process.env.HASNA_REPOS_DB_PATH;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(dbPath: string, args: string[]) {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.tsx", "repos", "--json", ...args],
    cwd: join(import.meta.dir, "../.."),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HASNA_REPOS_AUTO_BOOTSTRAP: "0", HASNA_REPOS_DB_PATH: dbPath },
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return JSON.parse(result.stdout.toString());
}

describe("repos stable snapshot pagination", () => {
  test("empty compact pages are truthful", () => {
    const body = run(":memory:", ["--limit", "1"]);
    expect(body).toMatchObject({ repos: [], count: 0, total: 0, limit: 1, cursor: null, has_more: false, compact: true });
  });

  test("updated_at churn and appends do not shift a cursor", () => {
    const root = mkdtempSync(join(tmpdir(), "repos-stable-page-"));
    roots.push(root);
    const dbPath = join(root, "repos.db");
    process.env.HASNA_REPOS_DB_PATH = dbPath;
    upsertRepo({ path: join(root, "a"), name: "a", remote_url: "github.com/hasna/a" });
    upsertRepo({ path: join(root, "b"), name: "b", remote_url: "github.com/hasna/b" });
    upsertRepo({ path: join(root, "c"), name: "c", remote_url: "github.com/hasna/c" });
    closeDb();
    delete process.env.HASNA_REPOS_DB_PATH;

    const first = run(dbPath, ["--limit", "1"]);
    expect(first.repos.map((repo: any) => repo.name)).toEqual(["a"]);

    const db = getDb(dbPath);
    db.query("UPDATE repos SET updated_at = '2099-01-01T00:00:00Z' WHERE name = 'a'").run();
    closeDb();
    process.env.HASNA_REPOS_DB_PATH = dbPath;
    upsertRepo({ path: join(root, "d"), name: "d", remote_url: "github.com/hasna/d" });
    closeDb();
    delete process.env.HASNA_REPOS_DB_PATH;

    const second = run(dbPath, ["--limit", "1", "--cursor", first.next_cursor]);
    expect(second.repos.map((repo: any) => repo.name)).toEqual(["b"]);
    expect(second.total).toBe(3);
    expect(second.snapshot_max_id).toBe(first.snapshot_max_id);
  });
});

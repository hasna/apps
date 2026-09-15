import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "instructions-cli-legacy-"));
  roots.push(root);
  const source = join(root, "configs.db");
  const destination = join(root, "instructions.db");
  const backup = join(root, "before.db");
  const db = new Database(source);
  db.exec(`
    CREATE TABLE configs (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, category TEXT NOT NULL, agent TEXT NOT NULL, target_path TEXT, format TEXT NOT NULL, content TEXT NOT NULL, description TEXT, tags TEXT NOT NULL, is_template INTEGER NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced_at TEXT);
    CREATE TABLE config_snapshots (id TEXT PRIMARY KEY, config_id TEXT NOT NULL, content TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE profile_configs (profile_id TEXT NOT NULL, config_id TEXT NOT NULL, sort_order INTEGER NOT NULL, PRIMARY KEY (profile_id, config_id));
    CREATE TABLE machines (id TEXT PRIMARY KEY, hostname TEXT NOT NULL UNIQUE, os TEXT, last_applied_at TEXT, created_at TEXT NOT NULL);
  `);
  db.run(`INSERT INTO configs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    "legacy-1", "Legacy", "legacy", "rules", "codex", null, "markdown", "legacy content", null, "[]", 0, 1,
    "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", null,
  ]);
  db.close();
  return { root, source, destination, backup };
}

function run(args: string[], paths: ReturnType<typeof fixture>) {
  return Bun.spawnSync([process.execPath, "src/cli/index.tsx", "migrate-legacy", ...args], {
    cwd: join(import.meta.dir, "../.."),
    env: {
      ...process.env,
      HOME: paths.root,
      HASNA_INSTRUCTIONS_LOCAL: "1",
      HASNA_INSTRUCTIONS_DB_PATH: paths.destination,
      HASNA_INSTRUCTIONS_API_URL: undefined,
      HASNA_INSTRUCTIONS_API_KEY: undefined,
      HASNA_HOME: paths.root,
      HASNA_STATION: "instructions-migrate-legacy-test",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("instructions migrate-legacy", () => {
  test("defaults to a no-write dry-run and requires explicit local confirmation", () => {
    const paths = fixture();
    const refused = run(["--source", paths.source, "--json"], paths);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr.toString()).toContain("--confirm-local");

    const planned = run(["--source", paths.source, "--confirm-local", "--json"], paths);
    expect(planned.exitCode).toBe(0);
    expect(JSON.parse(planned.stdout.toString())).toMatchObject({ dryRun: true, migrated: { configs: 1, snapshots: 1 } });
    const verify = new Database(paths.destination, { readonly: true });
    expect(verify.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM configs").get()?.count).toBe(0);
    verify.close();
  });

  test("applies through the explicit local-only command and creates a protected backup", () => {
    const paths = fixture();
    const applied = run([
      "--source", paths.source,
      "--destination", paths.destination,
      "--backup", paths.backup,
      "--confirm-local",
      "--apply",
      "--json",
    ], paths);
    expect(applied.exitCode).toBe(0);
    expect(JSON.parse(applied.stdout.toString())).toMatchObject({ dryRun: false, backupCreated: true, migrated: { configs: 1, snapshots: 1 } });
    expect(existsSync(paths.backup)).toBe(true);
    const verify = new Database(paths.destination, { readonly: true });
    expect(verify.query<{ content: string }, []>("SELECT content FROM configs WHERE id = 'legacy-1'").get()?.content).toBe("legacy content");
    verify.close();
  });

  test("hosted intent outranks a stale local opt-in", () => {
    const paths = fixture();
    const result = Bun.spawnSync([process.execPath, "src/cli/index.tsx", "migrate-legacy", "--source", paths.source, "--confirm-local"], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, HOME: paths.root, HASNA_INSTRUCTIONS_LOCAL: "1", HASNA_INSTRUCTIONS_API_URL: "https://api.hasna.com/instructions", HASNA_INSTRUCTIONS_API_KEY: "configured-hosted-intent" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("local-only");
    expect(existsSync(paths.destination)).toBe(false);
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { closeDatabase, getDatabase } from "../db/database.js";
import {
  isolatedStoreEnv,
} from "../test-support/store-isolation.js";
import {
  apiModeTestEnv,
  startTransportBatteryStubProcess,
  waitForTransportBatteryStub,
  type TransportBatteryStubProcess,
} from "../test-support/transport-battery-stub.js";

// ============================================================================
// Format gate for the LOCAL restore arm, driven cross-transport:
//
// `mementos backup` in hosted (API) mode writes a MEMORIES-ONLY CARRIER into
// the same backups dir (single bespoke `memories` table + `_backup_carrier`
// marker, no `_migrations` history and no agents/projects/relations/
// memory_versions tables). `mementos restore` in API mode re-ships that
// file's rows into the hosted store — but the LOCAL restore arm REPLACES the
// whole on-box database file, so a carrier handed to it would drop every
// non-memories table, strand restored rows without their join rows, and make
// the next migration run replay migrations over the half-shaped table
// (RENAME/rebuild collisions). The local arm therefore refuses carrier files
// up front (and any file that is not a mementos backup at all), while a full
// local database backup still round-trips byte-for-byte.
//
// End-to-end with the real CLI: the carrier is produced by a REAL hosted
// `mementos backup` against the loopback stub, then handed to the LOCAL
// `mementos restore`, which must refuse without touching the live DB.
// ============================================================================

const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;

let stub: TransportBatteryStubProcess;
let root = "";
let localDbPath = "";
let fullBackupPath = "";
let carrierPath = "";

function buildLiveLocalDb(): void {
  // A REAL migrated on-box database (memories + agents + _migrations …) with
  // one seeded memory — created through the app's own db layer.
  const db = getDatabase(localDbPath);
  db.run(
    `INSERT INTO memories (id, key, value) VALUES ('mem-format-1', 'format-key-1', 'seeded value')`,
  );
  // WAL checkpoint before the byte-copy backup below: without it the seeded
  // row can still live only in the -wal sidecar, and the backup file (a copy
  // of the main file alone) would be missing it.
  db.run("PRAGMA wal_checkpoint(TRUNCATE)");
  closeDatabase();
}

async function runCli(
  args: string[],
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

function sqliteTables(path: string): string[] {
  const db = new Database(path, { readonly: true });
  try {
    return (
      db
        .query("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>
    ).map((t) => t.name);
  } finally {
    db.close();
  }
}

function liveDbBytes(): Buffer {
  return readFileSync(localDbPath);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "mementos-restore-format-"));
  localDbPath = join(root, "live.db");
  fullBackupPath = join(root, "full-backup.db");
  carrierPath = join(root, "hosted-carrier.db");
  buildLiveLocalDb();
  // A full local backup is a byte copy of the live database.
  copyFileSync(localDbPath, fullBackupPath);
  stub = startTransportBatteryStubProcess();
  await waitForTransportBatteryStub(stub.baseUrl);
});

afterAll(() => {
  stub?.stop();
  if (root) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of a temp dir
    }
  }
});

function contentSignature(path: string): { tables: string[]; rowCounts: Record<string, number> } {
  const db = new Database(path, { readonly: true });
  try {
    const tables = (
      db
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    )
      .map((t) => t.name)
      .sort();
    const rowCounts: Record<string, number> = {};
    for (const name of tables) {
      rowCounts[name] = (db.query(`SELECT COUNT(*) AS count FROM "${name}"`).get() as { count: number }).count;
    }
    return { tables, rowCounts };
  } finally {
    db.close();
  }
}

describe("mementos restore: local arm format gate (cross-transport)", () => {
  test("a hosted (memories-only carrier) backup is refused by the local restore arm and the live DB is untouched", async () => {
    // Produce the carrier with the REAL hosted backup arm against the stub.
    const backup = await runCli(
      ["backup", carrierPath, "--json"],
      apiModeTestEnv(stub.baseUrl),
    );
    expect(backup.exitCode).toBe(0);
    expect(backup.stdout).toContain("cloud-api");
    // The carrier is self-identifying through the format marker.
    const carrierTables = sqliteTables(carrierPath);
    expect(carrierTables).toContain("_backup_carrier");
    expect(carrierTables).toContain("memories");
    expect(carrierTables).not.toContain("_migrations");
    expect(carrierTables).not.toContain("agents");

    const before = liveDbBytes();
    const dbTablesBefore = sqliteTables(localDbPath);
    expect(dbTablesBefore).toContain("agents");

    // --force restore of the carrier over the on-box DB must refuse cleanly.
    const restore = await runCli(
      ["restore", carrierPath, "--force", "--json"],
      isolatedStoreEnv(localDbPath),
    );
    expect(restore.exitCode).toBe(1);
    expect(restore.stdout).toContain("memories-only cloud backup");
    expect(restore.stdout).toContain("not a full local database backup");
    expect(restore.stderr).not.toContain("completed");

    // The dry-run (no --force) refuses identically: the gate fires before
    // any preview could read as a plausible restore.
    const preview = await runCli(
      ["restore", carrierPath, "--json"],
      isolatedStoreEnv(localDbPath),
    );
    expect(preview.exitCode).toBe(1);
    expect(preview.stdout).toContain("memories-only cloud backup");

    // Nothing was written: the live DB is byte-identical and fully intact.
    expect(liveDbBytes().equals(before)).toBe(true);
    const dbTablesAfter = sqliteTables(localDbPath);
    expect(dbTablesAfter).toContain("agents");
    expect(dbTablesAfter).toContain("_migrations");
    expect(dbTablesAfter).toContain("memories");
  });

  test("a full local database backup restores over the on-box DB and keeps the whole schema", async () => {
    const backupSignature = contentSignature(fullBackupPath);

    const restore = await runCli(
      ["restore", fullBackupPath, "--force", "--json"],
      isolatedStoreEnv(localDbPath),
    );
    expect(restore.exitCode).toBe(0);
    const result = JSON.parse(restore.stdout) as Record<string, unknown>;
    expect(result["action"]).toBe("restore");
    expect(result["status"]).toBe("completed");

    // The restored on-box DB is exactly the full backup: every table of the
    // migrated database (agents, _migrations, memory_versions, …) survived
    // with the same rows — never a memories-only carrier.
    const restored = contentSignature(localDbPath);
    expect(restored.tables).toEqual(backupSignature.tables);
    expect(restored.rowCounts).toEqual(backupSignature.rowCounts);
    expect(restored.tables).toContain("agents");
    expect(restored.tables).toContain("_migrations");
    expect(restored.tables).toContain("memories");
    expect(restored.tables).not.toContain("_backup_carrier");
    expect(restored.rowCounts["memories"] ?? 0).toBeGreaterThanOrEqual(1);
  });

  test("a file with no mementos memories table is refused, not copied over the DB", async () => {
    const junkPath = join(root, "not-a-backup.db");
    const db = new Database(junkPath);
    db.run("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
    db.run("INSERT INTO unrelated (id) VALUES (1)");
    db.close();

    const before = liveDbBytes();
    const restore = await runCli(
      ["restore", junkPath, "--force", "--json"],
      isolatedStoreEnv(localDbPath),
    );
    expect(restore.exitCode).toBe(1);
    expect(restore.stdout).toContain("not a mementos backup");
    expect(liveDbBytes().equals(before)).toBe(true);
  });
});

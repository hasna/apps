import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCriticalDbIntegrityReport,
  getOpsStateSnapshotReport,
  upsertMachineDataTasks,
  type MachineDataTaskSuggestion,
  type MachineDataTodosCommandRunner,
} from "../src/ops-data.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function sqliteDb(path: string): void {
  const db = new Database(path);
  db.exec("CREATE TABLE demo(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO demo(value) VALUES ('ok');");
  db.close();
}

describe("machine data ops producers", () => {
  test("checks bounded sqlite integrity and writes private report evidence", () => {
    const dir = tempRoot("machines-db-integrity");
    const reportDir = join(dir, "reports");
    sqliteDb(join(dir, "good.db"));
    writeFileSync(join(dir, "bad.db"), "not sqlite");

    const result = getCriticalDbIntegrityReport({
      roots: [dir],
      reportDir,
    });

    expect(result.kind).toBe("machine_data_db_integrity");
    expect(result.ok).toBe(false);
    expect(result.summary.discovered).toBe(2);
    expect(result.summary.failed).toBe(1);
    expect(result.task_suggestions).toHaveLength(1);
    const report = result.artifacts.find((artifact) => artifact.kind === "report")?.ref;
    expect(report).toBeTruthy();
    expect(statSync(report!).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(report!, "utf8")).summary.failed).toBe(1);
  });

  test("plans state snapshots by default and only writes snapshots with apply", () => {
    const dir = tempRoot("machines-state-snapshot");
    const snapshotRoot = join(dir, "snapshots");
    sqliteDb(join(dir, "state.db"));

    const planned = getOpsStateSnapshotReport({
      roots: [dir],
      snapshotRoot,
    });
    expect(planned.apply).toBe(false);
    expect(planned.summary.planned).toBe(1);
    expect(existsSync(snapshotRoot)).toBe(false);

    const applied = getOpsStateSnapshotReport({
      roots: [dir],
      snapshotRoot,
      apply: true,
    });
    expect(applied.apply).toBe(true);
    expect(applied.summary.copied).toBe(1);
    expect(applied.summary.failed).toBe(0);
    expect(applied.items[0]?.status).toBe("sqlite_backup");
    const copied = applied.items[0]?.snapshot_path;
    expect(copied).toBeTruthy();
    expect(existsSync(copied!)).toBe(true);
    expect(statSync(copied!).mode & 0o777).toBe(0o600);
  });

  test("uses sqlite backup for WAL-mode databases instead of unsafe file copy", () => {
    const dir = tempRoot("machines-state-wal");
    const snapshotRoot = join(dir, "snapshots");
    const dbPath = join(dir, "wal-state.db");
    const db = new Database(dbPath);
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE demo(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO demo(value) VALUES ('wal-data');");

    const applied = getOpsStateSnapshotReport({
      roots: [dir],
      snapshotRoot,
      apply: true,
    });

    db.close();
    expect(applied.summary.failed).toBe(0);
    expect(applied.items[0]?.status).toBe("sqlite_backup");
    const copied = applied.items[0]?.snapshot_path;
    expect(copied).toBeTruthy();
    const snapshot = new Database(copied!, { readonly: true });
    const row = snapshot.query("SELECT value FROM demo WHERE id = 1").get() as { value: string } | null;
    snapshot.close();
    expect(row?.value).toBe("wal-data");
  });

  test("fails closed instead of copying snapshots when sqlite3 is unavailable", () => {
    const dir = tempRoot("machines-state-no-sqlite");
    const snapshotRoot = join(dir, "snapshots");
    sqliteDb(join(dir, "state.db"));

    const applied = getOpsStateSnapshotReport({
      roots: [dir],
      snapshotRoot,
      apply: true,
      sqliteBin: "definitely-missing-sqlite3",
    });

    expect(applied.ok).toBe(false);
    expect(applied.summary.failed).toBe(1);
    expect(applied.items).toHaveLength(1);
    expect(applied.items[0]?.status).toBe("backup_failed");
    expect(applied.items[0]?.snapshot_path).toBeNull();
    expect(applied.items[0]?.message).toContain("definitely-missing-sqlite3 unavailable");
    expect(applied.task_suggestions).toHaveLength(1);
  });

  test("collapses missing sqlite3 integrity checks into one dependency task", () => {
    const dir = tempRoot("machines-db-no-sqlite");
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(join(dir, `state-${index}.db`), "not checked because sqlite is missing");
    }

    const result = getCriticalDbIntegrityReport({
      roots: [dir],
      sqliteBin: "definitely-missing-sqlite3",
    });

    expect(result.ok).toBe(false);
    expect(result.summary.discovered).toBe(5);
    expect(result.summary.failed).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.check_tool).toBe("none");
    expect(result.findings[0]?.message).toContain("skipped 5 discovered database files");
    expect(result.task_suggestions).toHaveLength(1);

    const added: string[] = [];
    const actions = upsertMachineDataTasks(result, {
      project: "/tmp/machines",
      runner: (args) => {
        if (args.includes("search")) return { status: 0, stdout: "[]", stderr: "" };
        if (args.includes("add")) {
          added.push(args[args.indexOf("add") + 1]!);
          return { status: 0, stdout: JSON.stringify({ id: "created-task" }), stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "unexpected" };
      },
    });

    expect(actions.map((action) => action.action)).toEqual(["created"]);
    expect(added).toEqual(["[machines:data] Restore sqlite3 for DB integrity checks"]);
  });

  test("uses sqlite backup for paths containing apostrophes", () => {
    const dir = tempRoot("machines-state-quote");
    const nested = join(dir, "operator's-state");
    mkdirSync(nested, { recursive: true });
    const snapshotRoot = join(dir, "snapshots");
    const dbPath = join(nested, "state.db");
    sqliteDb(dbPath);

    const applied = getOpsStateSnapshotReport({
      roots: [dir],
      snapshotRoot,
      apply: true,
    });

    expect(applied.ok).toBe(true);
    expect(applied.summary.copied).toBe(1);
    expect(applied.items[0]?.status).toBe("sqlite_backup");
    const copied = applied.items[0]?.snapshot_path;
    expect(copied).toContain("operator's-state");
    expect(existsSync(copied!)).toBe(true);
  });

  test("keeps max-db truncation output bounded while counting discovered databases", () => {
    const dir = tempRoot("machines-db-truncation");
    sqliteDb(join(dir, "first.db"));
    for (let index = 0; index < 25; index += 1) {
      writeFileSync(join(dir, `extra-${index}.db`), "not checked");
    }

    const result = getCriticalDbIntegrityReport({
      roots: [dir],
      maxDbs: 1,
    });

    expect(result.summary.discovered).toBeLessThanOrEqual(21);
    expect(result.summary.truncated).toBe(true);
    expect(result.findings.filter((finding) => finding.status === "skipped_max_dbs").length).toBeLessThanOrEqual(20);
    expect(result.findings.length).toBeLessThanOrEqual(21);
  });

  test("bounds total quick_check work with an effective time budget so the default run cannot hang", () => {
    const dir = tempRoot("machines-db-budget");
    // A fake sqlite3 that answers -version instantly but sleeps ~500ms on every
    // quick_check, standing in for slow probes over many real databases.
    const fakeSqlite = join(dir, "slow-sqlite3.sh");
    writeFileSync(
      fakeSqlite,
      [
        "#!/usr/bin/env bash",
        'for arg in "$@"; do',
        '  if [ "$arg" = "-version" ]; then echo "3.0.0 fake"; exit 0; fi',
        "done",
        "sleep 0.5",
        "echo ok",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(fakeSqlite, 0o755);
    for (let index = 0; index < 6; index += 1) sqliteDb(join(dir, `db-${index}.db`));

    const started = Date.now();
    const result = getCriticalDbIntegrityReport({
      roots: [dir],
      sqliteBin: fakeSqlite,
      maxTotalMs: 900,
    });
    const elapsed = Date.now() - started;

    // The effective cap is reported...
    expect(result.bounds.max_total_ms).toBe(900);
    // ...at least one database is deferred once the budget is exhausted instead of
    // being probed unconditionally (the pre-fix behavior probed all six)...
    const budgetSkipped = result.findings.filter((finding) => finding.status === "skipped_budget").length;
    expect(budgetSkipped).toBeGreaterThan(0);
    expect(result.summary.discovered).toBe(6);
    expect(result.summary.checked).toBeLessThan(6);
    // ...a probe truncated by the budget is deferred, never reported as a false
    // integrity failure...
    expect(result.summary.failed).toBe(0);
    expect(result.findings.every((finding) => finding.status !== "failed")).toBe(true);
    // ...and the whole run stays within bounded time (unbounded would be ~3s for six probes).
    expect(elapsed).toBeLessThan(2000);
  });

  test("retention removes only timestamp-shaped snapshot directories", () => {
    const dir = tempRoot("machines-state-retention");
    const snapshotRoot = join(dir, "snapshots");
    const oldTimestampDir = join(snapshotRoot, "20200101T000000Z");
    const oldOtherDir = join(snapshotRoot, "operator-notes");
    mkdirSync(oldTimestampDir, { recursive: true });
    mkdirSync(oldOtherDir, { recursive: true });
    const oldDate = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(oldTimestampDir, oldDate, oldDate);
    utimesSync(oldOtherDir, oldDate, oldDate);
    sqliteDb(join(dir, "state.db"));

    const applied = getOpsStateSnapshotReport({
      roots: [dir],
      snapshotRoot,
      apply: true,
      keepDays: 1,
    });

    expect(applied.summary.removed_old_snapshots).toBe(1);
    expect(existsSync(oldTimestampDir)).toBe(false);
    expect(existsSync(oldOtherDir)).toBe(true);
  });

  test("upserts machine-data task suggestions without starving new tasks behind existing ones", () => {
    const calls: string[][] = [];
    const added: string[] = [];
    let searches = 0;
    const runner: MachineDataTodosCommandRunner = (args) => {
      calls.push(args);
      if (args.includes("search")) {
        searches += 1;
        if (searches === 1) {
          return { status: 0, stdout: JSON.stringify([{ id: "active-task", status: "in_progress" }]), stderr: "" };
        }
        return { status: 0, stdout: "[]", stderr: "" };
      }
      if (args.includes("add")) {
        added.push(args[args.indexOf("add") + 1]!);
        return { status: 0, stdout: JSON.stringify({ id: "created-task", status: "pending" }), stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unexpected" };
    };
    const result = {
      generated_at: "2026-06-27T00:00:00.000Z",
      kind: "machine_data_db_integrity",
      ok: false,
      task_suggestions: [
        suggestion("existing"),
        suggestion("new"),
        suggestion("skipped"),
      ],
    };

    const actions = upsertMachineDataTasks(result, {
      project: "/home/hasna/.hasna/loops",
      maxActions: 1,
      runner,
    });

    expect(actions.map((action) => action.action)).toEqual(["existing", "created", "skipped"]);
    expect(actions[0]).toMatchObject({ task_id: "active-task" });
    expect(added).toHaveLength(1);
    expect(calls[0]?.slice(0, 3)).toEqual(["--project", "/home/hasna/.hasna/loops", "-j"]);
  });

  test("bounds default task creations when many machine-data suggestions exist", () => {
    const added: string[] = [];
    const runner: MachineDataTodosCommandRunner = (args) => {
      if (args.includes("search")) return { status: 0, stdout: "[]", stderr: "" };
      if (args.includes("add")) {
        added.push(args[args.indexOf("add") + 1]!);
        return { status: 0, stdout: JSON.stringify({ id: `created-${added.length}` }), stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unexpected" };
    };
    const result = {
      generated_at: "2026-06-27T00:00:00.000Z",
      kind: "machine_data_db_integrity",
      ok: false,
      task_suggestions: Array.from({ length: 12 }, (_, index) => suggestion(`many-${index}`)),
    };

    const actions = upsertMachineDataTasks(result, {
      project: "/home/hasna/.hasna/loops",
      runner,
    });

    expect(actions.filter((action) => action.action === "created")).toHaveLength(10);
    expect(actions.filter((action) => action.action === "skipped")).toHaveLength(2);
    expect(added).toHaveLength(10);
  });
});

function suggestion(name: string): MachineDataTaskSuggestion {
  return {
    fingerprint: name,
    dedupe_key: `machines:data:${name}`,
    title: `Fix ${name}`,
    description: "Do the safe remediation.",
    priority: "high",
    tags: ["machines", "ops-data"],
  };
}

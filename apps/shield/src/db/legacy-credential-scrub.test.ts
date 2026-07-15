import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scrubLegacyCredentialRows } from "./legacy-credential-scrub.js";
import { opaqueIdentifierForStorage } from "../lib/finding-safety.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createFixtureDb(): { db: Database; marker: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "shield-legacy-scrub-"));
  tempDirs.push(directory);
  const path = join(directory, "shield.db");
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE scans (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status TEXT NOT NULL, scanner_types TEXT NOT NULL, findings_count INTEGER NOT NULL,
      started_at TEXT NOT NULL, completed_at TEXT, duration_ms INTEGER, error TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE rules (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, scanner_type TEXT NOT NULL,
      severity TEXT NOT NULL, pattern TEXT, enabled INTEGER NOT NULL, builtin INTEGER NOT NULL,
      metadata TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE findings (
      id TEXT PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      rule_id TEXT NOT NULL REFERENCES rules(id), scanner_type TEXT NOT NULL, severity TEXT NOT NULL,
      file TEXT NOT NULL, line INTEGER NOT NULL, "column" INTEGER, end_line INTEGER, message TEXT NOT NULL,
      code_snippet TEXT, fingerprint TEXT NOT NULL, suppressed INTEGER NOT NULL, suppressed_reason TEXT,
      llm_explanation TEXT, llm_fix TEXT, llm_exploitability REAL, created_at TEXT NOT NULL
    );
    CREATE TABLE baselines (id TEXT PRIMARY KEY, finding_fingerprint TEXT NOT NULL);
    CREATE TABLE llm_cache (id TEXT PRIMARY KEY, finding_fingerprint TEXT NOT NULL);
  `);
  const marker = `gh${"o"}_${"Rollback_A4_".repeat(4)}`;
  db.prepare("INSERT INTO projects VALUES (?, ?, ?, ?, ?)").run(marker, marker, marker, marker, marker);
  db.prepare("INSERT INTO scans VALUES (?, ?, ?, ?, 1, ?, ?, 1, ?, ?)")
    .run(marker, marker, marker, JSON.stringify([marker]), marker, marker, marker, marker);
  db.prepare("INSERT INTO rules VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)")
    .run(marker, marker, marker, marker, marker, marker, JSON.stringify({ marker }), marker, marker);
  db.prepare(
    `INSERT INTO findings VALUES
      (?, ?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?, ?, 1, ?, ?, ?, 0.5, ?)`,
  ).run(
    marker,
    marker,
    marker,
    marker,
    marker,
    marker,
    marker,
    marker,
    marker,
    marker,
    marker,
    marker,
    marker,
  );
  db.prepare("INSERT INTO baselines VALUES ('baseline', ?)").run(marker);
  db.prepare("INSERT INTO llm_cache VALUES ('cache', ?)").run(marker);
  return { db, marker, path };
}

function rawDatabase(db: Database): string {
  return JSON.stringify(["projects", "scans", "rules", "findings", "baselines", "llm_cache"]
    .map((table) => db.prepare(`SELECT * FROM ${table}`).all()));
}

describe("legacy credential graph scrub", () => {
  test("serializes simultaneous scrub attempts from separate processes", async () => {
    const { db, marker, path } = createFixtureDb();
    const moduleUrl = new URL("./legacy-credential-scrub.ts", import.meta.url).href;
    const program = `
      import { Database } from "bun:sqlite";
      import { scrubLegacyCredentialRows } from ${JSON.stringify(moduleUrl)};
      const db = new Database(${JSON.stringify(path)});
      db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000");
      scrubLegacyCredentialRows(db);
      db.close();
    `;
    const spawn = () => Bun.spawn({
      cmd: [process.execPath, "-e", program],
      env: { PATH: process.env.PATH ?? "" },
      stderr: "ignore",
      stdout: "ignore",
    });
    try {
      const first = spawn();
      const second = spawn();
      expect(await first.exited).toBe(0);
      expect(await second.exited).toBe(0);
      expect(rawDatabase(db)).not.toContain(marker);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("is idempotent across independent SQLite handles", () => {
    const { db, marker, path } = createFixtureDb();
    const second = new Database(path);
    second.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000");
    try {
      const firstResult = scrubLegacyCredentialRows(db);
      const secondResult = scrubLegacyCredentialRows(second);
      expect(firstResult.scanIds.get(marker)).toBeDefined();
      expect(secondResult.scanIds.size).toBe(0);
      expect(rawDatabase(db)).not.toContain(marker);
      expect(rawDatabase(second)).not.toContain(marker);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(second.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      second.close();
      db.close();
    }
  });

  test("rolls back every parent and child mutation on a write failure", () => {
    const { db, marker } = createFixtureDb();
    try {
      db.exec(`
        CREATE TRIGGER reject_legacy_finding_update
        BEFORE UPDATE ON findings
        BEGIN
          SELECT RAISE(ABORT, 'synthetic write rejection');
        END;
      `);
      expect(() => scrubLegacyCredentialRows(db)).toThrow(
        "Unable to durably sanitize legacy credential data",
      );
      expect(rawDatabase(db)).toContain(marker);
      expect((db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS count FROM scans").get() as { count: number }).count).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS count FROM rules").get() as { count: number }).count).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS count FROM findings").get() as { count: number }).count).toBe(1);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      db.exec("DROP TRIGGER reject_legacy_finding_update");
      scrubLegacyCredentialRows(db);
      expect(rawDatabase(db)).not.toContain(marker);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("keeps collision candidates distinct and stable", () => {
    const { db, marker } = createFixtureDb();
    try {
      const occupiedScanId = opaqueIdentifierForStorage(marker, "SCAN-ID");
      db.prepare("INSERT INTO projects VALUES ('collision-project', 'safe', '/safe', 'now', 'now')").run();
      db.prepare("INSERT INTO scans VALUES (?, 'collision-project', 'completed', '[]', 0, 'now', NULL, 1, NULL, 'now')")
        .run(occupiedScanId);
      const result = scrubLegacyCredentialRows(db);
      const ids = [
        result.projectIds.get(marker),
        result.scanIds.get(marker),
        result.ruleIds.get(marker),
        result.findingIds.get(marker),
      ];
      expect(new Set(ids).size).toBe(4);
      expect(ids.every((id) => id?.startsWith("[REDACTED-"))).toBe(true);
      expect(result.scanIds.get(marker)).not.toBe(occupiedScanId);
      expect((db.prepare("SELECT COUNT(*) AS count FROM scans WHERE id = ?").get(occupiedScanId) as { count: number }).count)
        .toBe(1);
    } finally {
      db.close();
    }
  });
});

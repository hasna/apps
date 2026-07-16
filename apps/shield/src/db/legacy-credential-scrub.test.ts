import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scrubLegacyCredentialRows } from "./legacy-credential-scrub.js";
import {
  opaqueIdentifierForStorage,
  sanitizeFingerprintForOutput,
  sanitizeTextForBoundary,
} from "../lib/finding-safety.js";

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
    CREATE TABLE baselines (
      id TEXT PRIMARY KEY, finding_fingerprint TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'system', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE llm_cache (
      id TEXT PRIMARY KEY, finding_fingerprint TEXT NOT NULL, analysis_type TEXT NOT NULL,
      result TEXT NOT NULL, model TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(finding_fingerprint, analysis_type)
    );
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
  db.prepare("INSERT INTO baselines VALUES (?, ?, ?, ?, ?)")
    .run(marker, marker, marker, marker, marker);
  db.prepare("INSERT INTO llm_cache VALUES (?, ?, ?, ?, ?, 1, ?)")
    .run(marker, marker, marker, JSON.stringify({ marker }), marker, marker);
  return { db, marker, path };
}

function rawDatabase(db: Database): string {
  return JSON.stringify(["projects", "scans", "rules", "findings", "baselines", "llm_cache"]
    .map((table) => db.prepare(`SELECT * FROM ${table}`).all()));
}

function expectProductionMetadataClean(db: Database, marker: string): void {
  const baseline = db.prepare("SELECT * FROM baselines ORDER BY id LIMIT 1").get() as Record<
    string,
    unknown
  >;
  const cache = db.prepare("SELECT * FROM llm_cache ORDER BY id LIMIT 1").get() as Record<
    string,
    unknown
  >;
  expect(Object.keys(baseline).sort()).toEqual([
    "created_at",
    "created_by",
    "finding_fingerprint",
    "id",
    "reason",
  ]);
  expect(Object.keys(cache).sort()).toEqual([
    "analysis_type",
    "created_at",
    "finding_fingerprint",
    "id",
    "model",
    "result",
    "tokens_used",
  ]);
  for (const row of [baseline, cache]) {
    for (const value of Object.values(row)) {
      if (typeof value === "string") expect(value).not.toContain(marker);
    }
  }
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
      expectProductionMetadataClean(db, marker);
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
      const before = rawDatabase(db);
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
      expect(rawDatabase(db)).toBe(before);
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
      const occupiedBaselineId = opaqueIdentifierForStorage(marker, "BASELINE-ID");
      const occupiedCacheId = opaqueIdentifierForStorage(marker, "LLM-CACHE-ID");
      db.prepare("INSERT INTO projects VALUES ('collision-project', 'safe', '/safe', 'now', 'now')").run();
      db.prepare("INSERT INTO scans VALUES (?, 'collision-project', 'completed', '[]', 0, 'now', NULL, 1, NULL, 'now')")
        .run(occupiedScanId);
      db.prepare("INSERT INTO baselines VALUES (?, 'safe-fingerprint', 'safe', 'safe', 'now')")
        .run(occupiedBaselineId);
      db.prepare("INSERT INTO llm_cache VALUES (?, 'safe-fingerprint', 'safe', '{}', 'safe', 0, 'now')")
        .run(occupiedCacheId);
      const result = scrubLegacyCredentialRows(db);
      const ids = [
        result.projectIds.get(marker),
        result.scanIds.get(marker),
        result.ruleIds.get(marker),
        result.findingIds.get(marker),
        result.baselineIds.get(marker),
        result.llmCacheIds.get(marker),
      ];
      expect(new Set(ids).size).toBe(6);
      expect(ids.every((id) => id?.startsWith("[REDACTED-"))).toBe(true);
      expect(result.scanIds.get(marker)).not.toBe(occupiedScanId);
      expect(result.baselineIds.get(marker)).not.toBe(occupiedBaselineId);
      expect(result.llmCacheIds.get(marker)).not.toBe(occupiedCacheId);
      expect((db.prepare("SELECT COUNT(*) AS count FROM scans WHERE id = ?").get(occupiedScanId) as { count: number }).count)
        .toBe(1);
    } finally {
      db.close();
    }
  });

  test("scrubs baseline/cache-only exposure and is idempotent", () => {
    const { db, marker } = createFixtureDb();
    try {
      db.exec("DELETE FROM findings; DELETE FROM scans; DELETE FROM rules; DELETE FROM projects");
      const first = scrubLegacyCredentialRows(db);
      const second = scrubLegacyCredentialRows(db);

      expect(first.baselineIds.get(marker)).toBeDefined();
      expect(first.llmCacheIds.get(marker)).toBeDefined();
      expect(second.baselineIds.size).toBe(0);
      expect(second.llmCacheIds.size).toBe(0);
      expect(rawDatabase(db)).not.toContain(marker);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("rolls back baseline and cache mutations when either durable write fails", () => {
    const { db, marker } = createFixtureDb();
    try {
      db.exec("DELETE FROM findings; DELETE FROM scans; DELETE FROM rules; DELETE FROM projects");
      const before = rawDatabase(db);
      db.exec(`
        CREATE TRIGGER reject_cache_scrub
        BEFORE UPDATE ON llm_cache
        BEGIN
          SELECT RAISE(ABORT, 'synthetic cache write rejection');
        END;
      `);

      expect(() => scrubLegacyCredentialRows(db)).toThrow(
        "Unable to durably sanitize legacy credential data",
      );
      expect(rawDatabase(db)).toBe(before);
      expect(rawDatabase(db)).toContain(marker);

      db.exec("DROP TRIGGER reject_cache_scrub");
      scrubLegacyCredentialRows(db);
      expect(rawDatabase(db)).not.toContain(marker);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("preserves cache rows whose sanitized lookup keys collide", () => {
    const { db, marker } = createFixtureDb();
    try {
      const safeFingerprint = sanitizeFingerprintForOutput(marker);
      const safeAnalysisType = sanitizeTextForBoundary(marker, 128);
      db.prepare("INSERT INTO llm_cache VALUES ('safe-cache', ?, ?, '{}', 'safe', 0, 'now')")
        .run(safeFingerprint, safeAnalysisType);

      expect(() => scrubLegacyCredentialRows(db)).not.toThrow();
      expect(rawDatabase(db)).not.toContain(marker);
      expect(
        (db.prepare(
          "SELECT COUNT(*) AS count FROM llm_cache WHERE finding_fingerprint = ? AND analysis_type = ?",
        ).get(safeFingerprint, safeAnalysisType) as { count: number }).count,
      ).toBe(1);
      expect(
        (db.prepare("SELECT COUNT(*) AS count FROM llm_cache").get() as { count: number }).count,
      ).toBe(2);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import {
  addArtifact,
  listArtifacts,
  getArtifact,
  softDeleteArtifact,
  purgeArtifact,
  cleanupArtifacts,
  exportArtifacts,
  importArtifactFromManifestEntry,
  updateArtifactRedaction,
} from "./artifacts.js";
import { createTask } from "./tasks.js";
import {
  getArtifactStoreRoot,
  computeContentHash,
  buildArtifactExportManifest,
  isArtifactExpired,
} from "../lib/artifact-store.js";

let db: Database;
let tempDir: string;
let dbPath: string;
let sourceFile: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "todos-artifacts-test-"));
  dbPath = join(tempDir, "todos.db");
  process.env["TODOS_DB_PATH"] = dbPath;
  resetDatabase();
  db = getDatabase();
  sourceFile = join(tempDir, "evidence.log");
  writeFileSync(sourceFile, "test output line 1\n");
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("addArtifact", () => {
  it("should copy a file into the local artifact store", () => {
    const task = createTask({ title: "Test task" }, db);
    const artifact = addArtifact({
      entity_type: "task",
      entity_id: task.id,
      source_path: sourceFile,
      name: "evidence.log",
    }, db, dbPath);

    expect(artifact.id).toBeDefined();
    expect(artifact.entity_type).toBe("task");
    expect(artifact.entity_id).toBe(task.id);
    expect(artifact.storage_mode).toBe("copy");
    expect(artifact.content_hash).toBe(computeContentHash(sourceFile));
    expect(artifact.mime_type).toBe("text/plain");
    expect(artifact.size_bytes).toBeGreaterThan(0);
    expect(existsSync(artifact.local_path)).toBe(true);
    expect(readFileSync(artifact.local_path, "utf8")).toBe("test output line 1\n");
  });

  it("should support reference mode without copying", () => {
    const task = createTask({ title: "Ref task" }, db);
    const artifact = addArtifact({
      entity_type: "task",
      entity_id: task.id,
      source_path: sourceFile,
      storage_mode: "reference",
    }, db, dbPath);

    expect(artifact.storage_mode).toBe("reference");
    expect(artifact.local_path).toBe(sourceFile);
    expect(artifact.source_path).toBe(sourceFile);
  });

  it("should reject missing source files", () => {
    const task = createTask({ title: "Missing" }, db);
    expect(() => addArtifact({
      entity_type: "task",
      entity_id: task.id,
      source_path: join(tempDir, "missing.txt"),
    }, db, dbPath)).toThrow("Source file not found");
  });
});

describe("listArtifacts", () => {
  it("should filter by entity", () => {
    const task = createTask({ title: "List task" }, db);
    addArtifact({ entity_type: "task", entity_id: task.id, source_path: sourceFile }, db, dbPath);
    addArtifact({ entity_type: "handoff", entity_id: "handoff-1", source_path: sourceFile }, db, dbPath);

    const taskArtifacts = listArtifacts({ entity_type: "task", entity_id: task.id }, db);
    expect(taskArtifacts.length).toBe(1);
    expect(taskArtifacts[0]!.entity_type).toBe("task");
  });

  it("should exclude soft-deleted artifacts by default", () => {
    const task = createTask({ title: "Delete task" }, db);
    const artifact = addArtifact({ entity_type: "task", entity_id: task.id, source_path: sourceFile }, db, dbPath);
    softDeleteArtifact(artifact.id, db);
    expect(listArtifacts({ entity_id: task.id }, db).length).toBe(0);
    expect(listArtifacts({ entity_id: task.id, include_deleted: true }, db).length).toBe(1);
  });
});

describe("redaction and cleanup", () => {
  it("should update redaction status", () => {
    const task = createTask({ title: "Redact" }, db);
    const artifact = addArtifact({ entity_type: "task", entity_id: task.id, source_path: sourceFile }, db, dbPath);
    const updated = updateArtifactRedaction(artifact.id, "partial", db);
    expect(updated!.redaction_status).toBe("partial");
  });

  it("should purge expired soft-deleted artifacts", () => {
    const task = createTask({ title: "Cleanup" }, db);
    const artifact = addArtifact({ entity_type: "task", entity_id: task.id, source_path: sourceFile }, db, dbPath);
    const localPath = artifact.local_path;
    softDeleteArtifact(artifact.id, db);
    db.run("UPDATE artifacts SET deleted_at = ? WHERE id = ?", ["2020-01-01T00:00:00.000Z", artifact.id]);
    const purged = cleanupArtifacts({ deleted_retention_days: 1, now: new Date() }, db, dbPath);
    expect(purged).toBe(1);
    expect(getArtifact(artifact.id, db)).toBeNull();
    if (artifact.storage_mode === "copy") {
      expect(existsSync(localPath)).toBe(false);
    }
  });
});

describe("export and import", () => {
  it("should export artifacts manifest", () => {
    const task = createTask({ title: "Export" }, db);
    addArtifact({ entity_type: "task", entity_id: task.id, source_path: sourceFile, name: "evidence.log" }, db, dbPath);
    const manifest = exportArtifacts({ entity_id: task.id }, db, dbPath);
    expect(manifest.schema_version).toBe("todos.artifacts.v1");
    expect(manifest.artifacts.length).toBe(1);
    expect(manifest.store_root).toBe(getArtifactStoreRoot(dbPath));
  });

  it("should import with hash verification", () => {
    const task = createTask({ title: "Import" }, db);
    const hash = computeContentHash(sourceFile);
    const imported = importArtifactFromManifestEntry({
      entity_type: "task",
      entity_id: task.id,
      source_path: sourceFile,
      content_hash: hash,
    }, db, dbPath);
    expect(imported.content_hash).toBe(hash);
  });

  it("should reject import on hash mismatch", () => {
    const task = createTask({ title: "Bad import" }, db);
    expect(() => importArtifactFromManifestEntry({
      entity_type: "task",
      entity_id: task.id,
      source_path: sourceFile,
      content_hash: "deadbeef",
    }, db, dbPath)).toThrow("Content hash mismatch");
  });
});

describe("local-only guarantee", () => {
  it("artifact store module must not import network or cloud SDKs", () => {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const storeSrc = readFileSync(join(import.meta.dir, "../lib/artifact-store.ts"), "utf8");
    const artifactsSrc = readFileSync(join(import.meta.dir, "artifacts.ts"), "utf8");
    const forbidden = /\b(fetch|axios|https?\.|s3|aws-sdk|@aws-sdk|cloudflare|upload)\b/i;
    expect(forbidden.test(storeSrc)).toBe(false);
    expect(forbidden.test(artifactsSrc)).toBe(false);
  });

  it("isArtifactExpired respects retention policy", () => {
    expect(isArtifactExpired(null)).toBe(false);
    expect(isArtifactExpired("2020-01-01T00:00:00.000Z", { deleted_retention_days: 30, now: new Date() })).toBe(true);
    expect(isArtifactExpired(new Date().toISOString(), { deleted_retention_days: 30, now: new Date() })).toBe(false);
  });

  it("buildArtifactExportManifest uses local store root", () => {
    const manifest = buildArtifactExportManifest([], dbPath);
    expect(manifest.store_root).toContain("artifacts");
  });
});

describe("purgeArtifact", () => {
  it("should remove copied files from disk", () => {
    const task = createTask({ title: "Purge" }, db);
    const artifact = addArtifact({ entity_type: "task", entity_id: task.id, source_path: sourceFile }, db, dbPath);
    const localPath = artifact.local_path;
    expect(purgeArtifact(artifact.id, db, dbPath)).toBe(true);
    expect(existsSync(localPath)).toBe(false);
  });
});

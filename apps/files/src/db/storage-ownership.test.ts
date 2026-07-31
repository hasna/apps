/**
 * Storage-ownership guard for @hasna/files.
 *
 * @hasna/cloud is RETIRED. Its npm deprecation notice reads: "is retired and no
 * longer supported by Hasna. The source repo has been deleted. Do not add new
 * dependencies on it; services now own their storage (local SQLite /
 * self-hosted API)." Its GitHub repo is gone, so nothing can be patched there
 * ever again — a dependency on it is unfixable by construction.
 *
 * This package owns its storage directly through bun:sqlite. PR #18 (merged
 * 2026-07-30, six days AFTER the deprecation) replaced that with the
 * @hasna/cloud SqliteAdapter; this guard exists so the swap cannot land again
 * unnoticed.
 *
 * NOTE ON PROVENANCE: PR #18 added src/db/database.test.ts, whose central
 * assertion (`expect(db).toBeInstanceOf(SqliteAdapter)`) existed to ENFORCE the
 * retired dependency — its own comment read "Reverting database.ts must fail
 * here." That file is removed with the dependency, but its genuinely useful
 * coverage — schema tables present, transaction commit and rollback — is
 * preserved below against bun:sqlite, so reverting the dependency costs this
 * package no test coverage.
 *
 * Note also that src/lib/cloud-storage.ts is UNRELATED to this: it is the
 * @hasna/contracts self-hosted API client. The word "cloud" collides; the
 * dependency does not.
 *
 * EVERY guard assertion below is paired with a positive control asserting that
 * the same reader/scanner DOES find something genuinely present. Without those,
 * a broken reader returning `{}` or an empty file list would make this whole
 * file pass while checking nothing.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const RETIRED = "@hasna/cloud";
/** A dependency this package genuinely declares — the control for the manifest reader. */
const CONTROL_DEP = "@hasna/events";
/** A token that genuinely appears in src/ — the control for the tree scanner. */
const CONTROL_IMPORT = "bun:sqlite";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const SRC_ROOT = join(REPO_ROOT, "src");

const MANIFEST_DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * This guard file names the retired package in its own prose and constants, so
 * it matches its own scan. Excluding exactly this one path — and nothing else —
 * keeps the scan honest: any other file that mentions the package still fails.
 */
const SELF = join(import.meta.dir, import.meta.file);

function readManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8"));
}

/** Every package name declared in any dependency field of package.json. */
function declaredDependencies(): string[] {
  const manifest = readManifest();
  const names: string[] = [];
  for (const field of MANIFEST_DEP_FIELDS) {
    const block = manifest[field];
    if (block && typeof block === "object") names.push(...Object.keys(block));
  }
  return names;
}

/** Every .ts/.tsx file under src/, recursively, except this guard itself. */
function sourceFiles(dir: string = SRC_ROOT): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(full);
  }
  return found.filter((file) => file !== SELF);
}

function filesContaining(token: string): string[] {
  return sourceFiles().filter((file) => readFileSync(file, "utf-8").includes(token));
}

const originalDbPath = process.env.HASNA_FILES_DB_PATH;
const testDir = mkdtempSync(join(tmpdir(), "files-storage-ownership-"));

beforeAll(() => {
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
});

afterAll(async () => {
  const { closeDb } = await import("./database.js");
  closeDb();
  if (originalDbPath === undefined) delete process.env.HASNA_FILES_DB_PATH;
  else process.env.HASNA_FILES_DB_PATH = originalDbPath;
  rmSync(testDir, { recursive: true, force: true });
});

describe("storage ownership: no dependency on the retired @hasna/cloud", () => {
  test("package.json declares no @hasna/cloud in any dependency field", () => {
    const declared = declaredDependencies();

    // POSITIVE CONTROL: the reader must actually see this manifest's contents.
    expect(declared).toContain(CONTROL_DEP);

    expect(declared).not.toContain(RETIRED);
  });

  test("the lockfile resolves no @hasna/cloud", () => {
    const lock = readFileSync(join(REPO_ROOT, "bun.lock"), "utf-8");

    // POSITIVE CONTROL: the lockfile was actually read and resolves real deps.
    expect(lock).toContain(CONTROL_DEP);

    expect(lock).not.toContain(RETIRED);
  });

  test("no source file imports @hasna/cloud", () => {
    // POSITIVE CONTROL: the scanner must be able to find a token that IS there.
    expect(filesContaining(CONTROL_IMPORT).length).toBeGreaterThan(0);

    expect(filesContaining(RETIRED)).toEqual([]);
  });
});

describe("storage ownership: the local store still works (coverage kept from #18)", () => {
  test("the database handle is a bun:sqlite Database and carries the schema", async () => {
    const { getDb } = await import("./database.js");
    const db = getDb();

    // Behavioural, not textual: swapping in any adapter wrapper fails here even
    // if the import string were laundered past the scan above.
    expect(db).toBeInstanceOf(Database);

    const rows = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
      )
      .all();
    const names = new Set(rows.map((row) => row.name));

    for (const name of [
      "collections",
      "files",
      "files_fts",
      "machines",
      "peers",
      "projects",
      "sources",
      "tags",
    ]) {
      expect(names.has(name)).toBe(true);
    }
  });

  test("commits and rolls back writes through a bun:sqlite transaction", async () => {
    const { appendKnowledgeSourceOutboxEvent, getKnowledgeSourceOutboxEvent } =
      await import("./knowledge-outbox.js");

    const event = appendKnowledgeSourceOutboxEvent({
      event_type: "indexed",
      file_id: "file_tx_commit",
    });
    expect(event.cursor).toBeGreaterThan(0);
    expect(getKnowledgeSourceOutboxEvent(event.id)?.file_id).toBe("file_tx_commit");

    // bun:sqlite's transaction(fn) returns a CALLABLE; the retired adapter ran
    // the body itself. The trailing () is the call-site difference this revert
    // restores, so this asserts the restored shape as well as the rollback.
    const { getDb } = await import("./database.js");
    const db = getDb();
    expect(() =>
      db.transaction(() => {
        db.run(
          "INSERT INTO knowledge_source_outbox_events (id, cursor, event_type) VALUES (?, ?, ?)",
          ["out_tx_rollback", event.cursor + 1000, "indexed"],
        );
        throw new Error("boom");
      })(),
    ).toThrow("boom");
    expect(getKnowledgeSourceOutboxEvent("out_tx_rollback")).toBeNull();
  });
});

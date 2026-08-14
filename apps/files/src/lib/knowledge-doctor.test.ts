import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-knowledge-doctor-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
});

afterEach(async () => {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("knowledge source doctor", () => {
  test("reports ready, stale, ACL-revoked, deleted, missing text, and missing refs", async () => {
    const { getDb } = await import("../db/database.js");
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { markFileDeletedById, upsertFile } = await import("../db/files.js");
    const { getLatestFileVersion } = await import("../db/file-versions.js");
    const { doctorKnowledgeSources } = await import("./knowledge-doctor.js");
    const { buildOpenFilesFileRef } = await import("./source-ref.js");

    const sourceRoot = join(testDir!, "source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "ready.md"), "# Ready\n");
    writeFileSync(join(sourceRoot, "stale.md"), "first\n");
    writeFileSync(join(sourceRoot, "restricted.md"), "# Restricted\n");
    writeFileSync(join(sourceRoot, "deleted.md"), "# Deleted\n");
    writeFileSync(join(sourceRoot, "blob.bin"), Buffer.from([0, 1, 2]));

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Doctor docs",
      type: "local",
      path: sourceRoot,
      machine_id: machine.id,
    });
    const ready = upsertFile({
      id: "f_doctorReady",
      source_id: source.id,
      machine_id: machine.id,
      path: "ready.md",
      name: "ready.md",
      ext: ".md",
      size: Buffer.byteLength("# Ready\n"),
      mime: "text/markdown",
      hash: "a".repeat(64),
      status: "active",
      modified_at: "2026-06-10T00:00:00.000Z",
    });
    const stale = upsertFile({
      id: "f_doctorStale",
      source_id: source.id,
      machine_id: machine.id,
      path: "stale.md",
      name: "stale.md",
      ext: ".md",
      size: Buffer.byteLength("first\n"),
      mime: "text/markdown",
      hash: "b".repeat(64),
      status: "active",
      modified_at: "2026-06-10T00:00:00.000Z",
    });
    const staleFirstRevision = getLatestFileVersion(stale.id)!;
    writeFileSync(join(sourceRoot, "stale.md"), "second\n");
    upsertFile({
      id: stale.id,
      source_id: source.id,
      machine_id: machine.id,
      path: "stale.md",
      name: "stale.md",
      ext: ".md",
      size: Buffer.byteLength("second\n"),
      mime: "text/markdown",
      hash: "c".repeat(64),
      status: "active",
      modified_at: "2026-06-10T00:01:00.000Z",
    });
    const restricted = upsertFile({
      id: "f_doctorRestricted",
      source_id: source.id,
      machine_id: machine.id,
      path: "restricted.md",
      name: "restricted.md",
      ext: ".md",
      size: Buffer.byteLength("# Restricted\n"),
      mime: "text/markdown",
      hash: "d".repeat(64),
      status: "active",
      modified_at: "2026-06-10T00:00:00.000Z",
    });
    getDb().run(
      `INSERT INTO file_organization_reviews (
        id, file_id, source_id, root_type, original_path, current_path,
        owner, labels, review_status, priority, metadata,
        acl_review_status, permission_scope, permission_risk, permissions_metadata
      ) VALUES (?, ?, ?, 'shared_drive', ?, ?, ?, '[]', 'in_review', 'high', '{}', 'restricted', 'public', 'high', '{}')`,
      ["rev_doctor_acl", restricted.id, source.id, restricted.path, restricted.path, "security"],
    );
    const deleted = upsertFile({
      id: "f_doctorDeleted",
      source_id: source.id,
      machine_id: machine.id,
      path: "deleted.md",
      name: "deleted.md",
      ext: ".md",
      size: Buffer.byteLength("# Deleted\n"),
      mime: "text/markdown",
      hash: "e".repeat(64),
      status: "active",
      modified_at: "2026-06-10T00:00:00.000Z",
    });
    expect(markFileDeletedById(deleted.id)).toBe(true);
    const binary = upsertFile({
      id: "f_doctorBinary",
      source_id: source.id,
      machine_id: machine.id,
      path: "blob.bin",
      name: "blob.bin",
      ext: ".bin",
      size: 3,
      mime: "application/octet-stream",
      hash: "f".repeat(64),
      status: "active",
      modified_at: "2026-06-10T00:00:00.000Z",
    });

    const report = await doctorKnowledgeSources({
      source_refs: [
        buildOpenFilesFileRef(ready.id),
        staleFirstRevision.source_ref,
        buildOpenFilesFileRef(restricted.id),
        buildOpenFilesFileRef(deleted.id),
        buildOpenFilesFileRef(binary.id),
        "open-files://file/f_missing",
      ],
    });
    const byRef = new Map(report.checks.map((check) => [check.source_ref, check]));

    expect(report.summary).toMatchObject({
      ready: 1,
      stale: 1,
      acl_revoked: 1,
      deleted: 1,
      missing_extracted_text: 1,
      not_found: 1,
    });
    expect(byRef.get(buildOpenFilesFileRef(ready.id))?.status).toBe("ready");
    expect(byRef.get(staleFirstRevision.source_ref)?.issue_codes).toContain("stale_revision");
    expect(byRef.get(buildOpenFilesFileRef(restricted.id))?.issue_codes).toContain("acl_revoked");
    expect(byRef.get(buildOpenFilesFileRef(deleted.id))?.actions).toContain("drop_from_index");
    expect(byRef.get(buildOpenFilesFileRef(binary.id))?.recommendation).toBe("reindex");
    expect(byRef.get("open-files://file/f_missing")?.recommendation).toBe("fix_ref");
    expect(JSON.stringify(report)).not.toContain("first");
    expect(JSON.stringify(report)).not.toContain("second");
  });
});

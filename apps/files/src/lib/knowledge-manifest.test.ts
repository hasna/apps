import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-knowledge-manifest-"));
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

describe("knowledge source manifest export", () => {
  test("exports selected file metadata with source refs, revisions, storage, extraction availability, and JSONL artifact output", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { tagFile } = await import("../db/tags.js");
    const { createCollection, addToCollection } = await import("../db/collections.js");
    const { createProject, addToProject } = await import("../db/projects.js");
    const { exportKnowledgeSourceManifest, formatKnowledgeSourceManifest } = await import("./knowledge-manifest.js");

    const sourceRoot = join(testDir!, "source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "knowledge.md"), "# Knowledge\n");
    writeFileSync(join(sourceRoot, "skip.txt"), "skip\n");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Manifest source",
      type: "local",
      path: sourceRoot,
      machine_id: machine.id,
    });
    const included = upsertFile({
      id: "f_manifestIncluded",
      source_id: source.id,
      machine_id: machine.id,
      path: "knowledge.md",
      name: "knowledge.md",
      ext: ".md",
      size: Buffer.byteLength("# Knowledge\n"),
      mime: "text/markdown",
      hash: "d".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });
    upsertFile({
      id: "f_manifestSkipped",
      source_id: source.id,
      machine_id: machine.id,
      path: "skip.txt",
      name: "skip.txt",
      ext: ".txt",
      size: 5,
      mime: "text/plain",
      status: "active",
      modified_at: "2026-06-08T00:00:00.000Z",
    });
    tagFile(included.id, "knowledge");
    const collection = createCollection("Knowledge collection");
    addToCollection(collection.id, included.id);
    const project = createProject("Knowledge project");
    addToProject(project.id, included.id);

    const outPath = join(testDir!, "out", "manifest.jsonl");
    const manifest = await exportKnowledgeSourceManifest({
      tag: "knowledge",
      collection_id: collection.id,
      project_id: project.id,
      format: "jsonl",
      output: { provider: "local", path: outPath, format: "jsonl" },
    });

    expect(manifest.item_count).toBe(1);
    expect(manifest.artifact).toMatchObject({ provider: "local", path: outPath, format: "jsonl" });
    expect(existsSync(outPath)).toBe(true);
    const item = manifest.items[0];
    expect(item?.kind).toBe("file");
    if (item?.kind !== "file") throw new Error("Expected file manifest item");
    expect(item).toMatchObject({
      source_ref: "open-files://file/f_manifestIncluded",
      file_id: "f_manifestIncluded",
      source_id: source.id,
      path: "knowledge.md",
      mime: "text/markdown",
      status: "active",
      deleted: false,
      tags: ["knowledge"],
      open_files_root: {
        open_files_root: `open-files://source/${source.id}`,
        source_id: source.id,
        source_type: "local",
        source_path: "knowledge.md",
        machine: {
          machine_id: machine.id,
          hostname: machine.hostname,
        },
        local: { path: sourceRoot },
      },
      storage: { provider: "local", source_id: source.id },
      extraction: { text_available: true, status: "available" },
      permissions: {
        mode: "read_only",
        allowed_purposes: ["knowledge_index", "knowledge_answer", "agent_context"],
      },
    });
    expect(item.open_files_root.evidence_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(item.revision_ref).toMatch(/^open-files:\/\/file\/f_manifestIncluded\/revision\/rev_/);
    expect(item.hash).toBe(`blake3:${"d".repeat(64)}`);
    expect(item.permission_labels).toContain("read_only");
    expect(item.permission_labels).toContain("source_enabled");
    expect(formatKnowledgeSourceManifest(manifest, "jsonl").trim()).toBe(readFileSync(outPath, "utf8").trim());
  });

  test("paginates file manifests with opaque cursors", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { exportKnowledgeSourceManifest } = await import("./knowledge-manifest.js");

    const sourceRoot = join(testDir!, "paged-source");
    mkdirSync(sourceRoot, { recursive: true });
    const machine = getCurrentMachine();
    const source = createSource({
      name: "Paged source",
      type: "local",
      path: sourceRoot,
      machine_id: machine.id,
    });

    for (const id of ["a", "b", "c"]) {
      const name = `${id}.txt`;
      writeFileSync(join(sourceRoot, name), id);
      upsertFile({
        id: `f_page_${id}`,
        source_id: source.id,
        machine_id: machine.id,
        path: name,
        name,
        ext: ".txt",
        size: 1,
        mime: "text/plain",
        status: "active",
        modified_at: `2026-06-09T00:00:0${id.charCodeAt(0) - 96}.000Z`,
      });
    }

    const first = await exportKnowledgeSourceManifest({ source_id: source.id, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toBeDefined();

    const second = await exportKnowledgeSourceManifest({ source_id: source.id, cursor: first.next_cursor });
    expect(second.items).toHaveLength(1);
    expect(second.next_cursor).toBeUndefined();
    expect(new Set([...first.items, ...second.items].map((item) => item.kind === "file" ? item.file_id : item.asset_id))).toEqual(
      new Set(["f_page_a", "f_page_b", "f_page_c"]),
    );
    expect(first.high_watermark).toBe(0);
    expect(first.delta_cursor).toBeDefined();
  });

  test("includes S3 source root evidence without reading object bytes", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { exportKnowledgeSourceManifest } = await import("./knowledge-manifest.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "S3 manifest source",
      type: "s3",
      bucket: "example-files-bucket",
      prefix: "imports/google-drive/live",
      region: "us-east-1",
      config: { profile: "test-aws-profile" },
      machine_id: machine.id,
    });
    upsertFile({
      id: "f_manifest_s3_root",
      source_id: source.id,
      machine_id: machine.id,
      path: "imports/google-drive/live/doc.md",
      name: "doc.md",
      ext: ".md",
      size: 12,
      mime: "text/markdown",
      hash: "a".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });

    const manifest = await exportKnowledgeSourceManifest({ source_id: source.id });
    const item = manifest.items[0];
    expect(item?.kind).toBe("file");
    if (item?.kind !== "file") throw new Error("Expected file item");
    expect(item.open_files_root).toMatchObject({
      open_files_root: `open-files://source/${source.id}`,
      source_type: "s3",
      source_path: "imports/google-drive/live/doc.md",
      machine: { machine_id: machine.id },
      s3: {
        bucket: "example-files-bucket",
        prefix: "imports/google-drive/live",
        region: "us-east-1",
      },
    });
    expect(JSON.stringify(item.open_files_root)).not.toContain("test-aws-profile");
  });

  test("exports delta manifests with tombstones and source revision hashes", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { markFileDeletedById, upsertFile } = await import("../db/files.js");
    const { exportKnowledgeSourceManifest } = await import("./knowledge-manifest.js");

    const sourceRoot = join(testDir!, "delta-source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "changed.txt"), "before");
    writeFileSync(join(sourceRoot, "deleted.txt"), "delete me");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Delta source",
      type: "local",
      path: sourceRoot,
      machine_id: machine.id,
    });
    upsertFile({
      id: "f_delta_changed",
      source_id: source.id,
      machine_id: machine.id,
      path: "changed.txt",
      name: "changed.txt",
      ext: ".txt",
      size: 6,
      mime: "text/plain",
      hash: "1".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });
    upsertFile({
      id: "f_delta_deleted",
      source_id: source.id,
      machine_id: machine.id,
      path: "deleted.txt",
      name: "deleted.txt",
      ext: ".txt",
      size: 9,
      mime: "text/plain",
      hash: "2".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });

    const baseline = await exportKnowledgeSourceManifest({ source_id: source.id });
    expect(baseline.high_watermark).toBe(0);

    upsertFile({
      id: "f_delta_changed",
      source_id: source.id,
      machine_id: machine.id,
      path: "changed.txt",
      name: "changed.txt",
      ext: ".txt",
      size: 7,
      mime: "text/plain",
      hash: "3".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:01:00.000Z",
    });
    expect(markFileDeletedById("f_delta_deleted")).toBe(true);

    const delta = await exportKnowledgeSourceManifest({
      source_id: source.id,
      delta: true,
      since_cursor: baseline.delta_cursor,
    });

    expect(delta.delta).toBe(true);
    expect(delta.items).toHaveLength(2);
    expect(delta.tombstone_count).toBe(1);
    expect(delta.high_watermark).toBe(1);
    const changed = delta.items.find((item) => item.kind === "file" && item.file_id === "f_delta_changed");
    const deleted = delta.items.find((item) => item.kind === "file" && item.file_id === "f_delta_deleted");
    expect(changed?.kind).toBe("file");
    expect(deleted?.kind).toBe("file");
    if (changed?.kind !== "file" || deleted?.kind !== "file") throw new Error("Expected file items");
    expect(changed.sync_version).toBe(1);
    expect(changed.tombstone).toBeUndefined();
    expect(changed.source_revision_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(deleted.deleted).toBe(true);
    expect(deleted.tombstone).toBe(true);
    expect(deleted.status).toBe("deleted");
  });

  test("includes evidence asset rows with storage descriptors and links when requested", async () => {
    const {
      createFileAsset,
      createFileLink,
      updateFileAssetStatus,
    } = await import("../db/evidence.js");
    const { exportKnowledgeSourceManifest } = await import("./knowledge-manifest.js");

    createFileAsset({
      id: "asset_manifest",
      org_id: "org_1",
      company_id: "co_1",
      app: "files",
      kind: "contract",
      classification: "confidential",
      original_name: "contract.pdf",
      content_type: "application/pdf",
      size: 1234,
      checksum: "e".repeat(64),
      checksum_algorithm: "sha256",
      storage_provider: "s3",
      bucket: "example-files-bucket",
      region: "us-east-1",
      object_key: "evidence/contracts/contract.pdf",
    });
    updateFileAssetStatus({ id: "asset_manifest", status: "verified", scan_status: "clean", verified: true });
    createFileLink({
      asset_id: "asset_manifest",
      org_id: "org_1",
      company_id: "co_1",
      app: "files",
      source_type: "task",
      source_id: "task_1",
      kind: "supporting_evidence",
    });

    const manifest = await exportKnowledgeSourceManifest({
      include_evidence_assets: true,
      evidence: { app: "files" },
    });

    const item = manifest.items.find((entry) => entry.kind === "evidence_asset");
    expect(item?.kind).toBe("evidence_asset");
    if (item?.kind !== "evidence_asset") throw new Error("Expected evidence asset manifest item");
    expect(item).toMatchObject({
      asset_ref: "open-files://asset/asset_manifest",
      asset_id: "asset_manifest",
      app: "files",
      asset_kind: "contract",
      mime: "application/pdf",
      hash: `sha256:${"e".repeat(64)}`,
      status: "verified",
      scan_status: "clean",
      storage: {
        provider: "s3",
        bucket: "example-files-bucket",
        key: "evidence/contracts/contract.pdf",
      },
    });
    expect(item.links).toHaveLength(1);
    expect(item.source_ref).toBe("open-files://asset/asset_manifest");
    expect(item.revision_ref).toMatch(/^open-files:\/\/asset\/asset_manifest\/revision\/assetrev_/);
    expect(item.source_revision_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(item.redaction).toMatchObject({
      status: "metadata_only",
      metadata_only: true,
      raw_bytes_copied: false,
      raw_text_copied: false,
      private_inventory_copied: false,
      secret_values_copied: false,
    });
    expect(item.permissions).toMatchObject({
      mode: "read_only",
      write: false,
      allowed_purposes: ["knowledge_index", "knowledge_answer", "agent_context"],
    });
    expect(item.permission_labels).toContain("metadata_only");
    expect(item.permission_labels).toContain("classification:confidential");
  });

  test("exports private fleet manifest evidence as metadata-only source refs", async () => {
    const {
      createFileAsset,
      createFileLink,
      updateFileAssetStatus,
    } = await import("../db/evidence.js");
    const { exportKnowledgeSourceManifest, formatKnowledgeSourceManifest } = await import("./knowledge-manifest.js");

    const rawInventory = JSON.stringify({
      machines: [
        { hostname: "real-prod-host-001.internal", serial: "PRIVATE-SERIAL-001" },
      ],
    });
    const rawPath = join(testDir!, "private-fleet-inventory.json");
    writeFileSync(rawPath, rawInventory);
    createFileAsset({
      id: "asset_fleet_manifest",
      org_id: "org_1",
      company_id: "co_1",
      app: "machines",
      kind: "fleet_manifest",
      classification: "restricted",
      original_name: "fleet-manifest.json",
      content_type: "application/json",
      size: Buffer.byteLength(rawInventory),
      checksum: "9".repeat(64),
      checksum_algorithm: "sha256",
      storage_provider: "s3",
      bucket: "example-files-bucket",
      region: "us-east-1",
      object_key: "private/fleet/manifests/asset_fleet_manifest.json",
      metadata: {
        source_family: "private_fleet_manifest",
        example_machine: "fictional-macbook-pro-01",
      },
    });
    updateFileAssetStatus({ id: "asset_fleet_manifest", status: "verified", scan_status: "clean", verified: true });
    createFileLink({
      asset_id: "asset_fleet_manifest",
      org_id: "org_1",
      company_id: "co_1",
      app: "machines",
      source_type: "machine_fleet",
      source_id: "fictional-fleet",
      kind: "source_manifest",
      metadata: { machine_ref: "fictional-macbook-pro-01" },
    });

    const manifest = await exportKnowledgeSourceManifest({
      include_evidence_assets: true,
      evidence: { app: "machines", kind: "fleet_manifest" },
    });

    const item = manifest.items.find((entry) => entry.kind === "evidence_asset");
    expect(item?.kind).toBe("evidence_asset");
    if (item?.kind !== "evidence_asset") throw new Error("Expected evidence asset manifest item");
    expect(item).toMatchObject({
      source_ref: "open-files://asset/asset_fleet_manifest",
      asset_ref: "open-files://asset/asset_fleet_manifest",
      asset_id: "asset_fleet_manifest",
      app: "machines",
      asset_kind: "fleet_manifest",
      classification: "restricted",
      hash: `sha256:${"9".repeat(64)}`,
      storage: {
        provider: "s3",
        bucket: "example-files-bucket",
        key: "private/fleet/manifests/asset_fleet_manifest.json",
      },
      redaction: {
        status: "metadata_only",
        raw_bytes_copied: false,
        raw_text_copied: false,
        private_inventory_copied: false,
        secret_values_copied: false,
      },
      permissions: {
        mode: "read_only",
        write: false,
      },
    });
    expect(item.revision_id).toMatch(/^assetrev_[a-f0-9]{24}$/);
    expect(item.revision_ref).toMatch(/^open-files:\/\/asset\/asset_fleet_manifest\/revision\/assetrev_[a-f0-9]{24}$/);
    expect(item.source_revision_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(item.links[0]?.metadata).toMatchObject({ machine_ref: "fictional-macbook-pro-01" });
    expect(item.permission_labels).toContain("raw_bytes_owned_by:open-files");

    const serialized = formatKnowledgeSourceManifest(manifest, "json");
    expect(serialized).toContain("fictional-macbook-pro-01");
    expect(serialized).not.toContain("real-prod-host-001");
    expect(serialized).not.toContain("PRIVATE-SERIAL-001");
  });

  test("includes ACL summaries when requested", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { upsertGoogleDriveImportedObject } = await import("../db/google-drive.js");
    const {
      bootstrapGoogleDriveOrganizationQueues,
      listFileOrganizationReviews,
      updateFileOrganizationReview,
    } = await import("../db/organization.js");
    const { exportKnowledgeSourceManifest } = await import("./knowledge-manifest.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Drive ACL source",
      type: "google_drive",
      config: {
        profile: "test",
        include_my_drive: true,
        include_all_shared_drives: true,
      },
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_manifest_acl",
      source_id: source.id,
      machine_id: machine.id,
      path: "google-drive/test/my-drive/legal/contract.txt",
      name: "contract.txt",
      ext: ".txt",
      size: 10,
      mime: "text/plain",
      hash: "f".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });
    upsertGoogleDriveImportedObject({
      source_id: source.id,
      drive_id: "my-drive",
      file_id: "drive-manifest-acl",
      profile: "test",
      path: "legal/contract.txt",
      name: "contract.txt",
      mime: "text/plain",
      size: 10,
      storage_type: "s3",
      storage_key: "objects/sha256/ff/ff/content",
      s3_key: "google-drive/test/my-drive/legal/contract.txt",
      raw_bucket: "legacy",
      raw_key: "google-drive/test/my-drive/legal/contract.txt",
      canonical_bucket: "canonical",
      canonical_key: "objects/sha256/ff/ff/content",
      canonical_sha256: "f".repeat(64),
      promotion_status: "mapped",
      file_record_id: file.id,
      deleted: false,
      last_imported_at: "2026-06-09T00:00:00.000Z",
    });
    bootstrapGoogleDriveOrganizationQueues();
    const review = listFileOrganizationReviews({ limit: 1 })[0]!;
    updateFileOrganizationReview(review.id, {
      owner: "legal",
      acl_review_status: "approved",
      permission_scope: "private",
      permission_risk: "low",
      target_path: "legal/contracts/contract.txt",
    });

    const manifest = await exportKnowledgeSourceManifest({
      source_id: source.id,
      include_acl_summary: true,
    });
    const item = manifest.items[0];
    expect(item?.kind).toBe("file");
    if (item?.kind !== "file") throw new Error("Expected file item");
    expect(item.acl_summary).toMatchObject({
      review_id: review.id,
      owner: "legal",
      acl_review_status: "approved",
      permission_scope: "private",
      permission_risk: "low",
      target_path: "legal/contracts/contract.txt",
    });
    expect(item.open_files_root).toMatchObject({
      open_files_root: `open-files://source/${source.id}`,
      source_type: "google_drive",
      source_path: "google-drive/test/my-drive/legal/contract.txt",
      machine: { machine_id: machine.id },
    });
  });
});

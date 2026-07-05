import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-knowledge-outbox-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
});

afterEach(async () => {
  const { closeDb } = await import("./database.js");
  closeDb();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("knowledge source outbox", () => {
  test("emits ordered file mutation events and checkpoints consumer progress", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { upsertFile, markFileDeletedById } = await import("./files.js");
    const {
      acknowledgeKnowledgeSourceOutbox,
      getKnowledgeSourceOutboxCheckpoint,
      pollKnowledgeSourceOutbox,
    } = await import("./knowledge-outbox.js");

    const root = join(testDir!, "source");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "doc.txt"), "first");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Outbox source",
      type: "local",
      path: root,
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_outbox",
      source_id: source.id,
      machine_id: machine.id,
      path: "doc.txt",
      name: "doc.txt",
      ext: ".txt",
      size: 5,
      mime: "text/plain",
      hash: "a".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });
    upsertFile({
      id: file.id,
      source_id: source.id,
      machine_id: machine.id,
      path: "doc.txt",
      name: "doc.txt",
      ext: ".txt",
      size: 6,
      mime: "text/plain",
      hash: "b".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:01:00.000Z",
    });
    expect(markFileDeletedById(file.id)).toBe(true);

    const firstPoll = pollKnowledgeSourceOutbox({ consumer_id: "knowledge-indexer", file_id: file.id, limit: 3 });
    expect(firstPoll.events.map((event) => event.event_type)).toEqual(["indexed", "hash_changed", "revision_changed"]);
    expect(firstPoll.has_more).toBe(true);
    expect(firstPoll.events[1]).toMatchObject({
      file_id: "f_outbox",
      source_id: source.id,
      path: "doc.txt",
      mime: "text/plain",
    });
    expect(firstPoll.events[1]!.source_ref).toMatch(/^open-files:\/\/file\/f_outbox\/revision\/rev_/);

    const checkpoint = acknowledgeKnowledgeSourceOutbox("knowledge-indexer", firstPoll.next_cursor, {
      worker: "test",
    });
    expect(checkpoint.cursor).toBe(firstPoll.next_cursor);
    expect(getKnowledgeSourceOutboxCheckpoint("knowledge-indexer")?.metadata).toEqual({ worker: "test" });

    const secondPoll = pollKnowledgeSourceOutbox({ consumer_id: "knowledge-indexer", file_id: file.id });
    expect(secondPoll.events.map((event) => event.event_type)).toEqual(["deleted"]);
    expect(secondPoll.cursor).toBe(firstPoll.next_cursor);
    expect(secondPoll.next_cursor).toBeGreaterThan(firstPoll.next_cursor);
    expect(secondPoll.watermark.latest_cursor).toBeGreaterThanOrEqual(secondPoll.next_cursor);
  });

  test("deduplicates idempotent events", async () => {
    const { appendKnowledgeSourceOutboxEvent, listKnowledgeSourceOutboxEvents } = await import("./knowledge-outbox.js");

    const first = appendKnowledgeSourceOutboxEvent({
      event_type: "extraction_ready",
      source_ref: "open-files://file/f_extract/revision/rev_1",
      file_id: "f_extract",
      revision_id: "rev_1",
      idempotency_key: "extract:f_extract:rev_1",
    });
    const second = appendKnowledgeSourceOutboxEvent({
      event_type: "extraction_ready",
      source_ref: "open-files://file/f_extract/revision/rev_1",
      file_id: "f_extract",
      revision_id: "rev_1",
      idempotency_key: "extract:f_extract:rev_1",
    });

    expect(second.id).toBe(first.id);
    expect(listKnowledgeSourceOutboxEvents()).toHaveLength(1);
  });

  test("emits source disabled/update events without leaking source config details", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource, updateSource } = await import("./sources.js");
    const { listKnowledgeSourceOutboxEvents } = await import("./knowledge-outbox.js");

    const machine = getCurrentMachine();
    expect(() => createSource({
      name: "S3 source with static credentials",
      type: "s3",
      bucket: "hasna-xyz-opensource-files-test",
      region: "us-east-1",
      config: {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "do-not-store-this",
      },
      machine_id: machine.id,
    })).toThrow("must not contain static credentials");

    const source = createSource({
      name: "S3 source",
      type: "s3",
      bucket: "hasna-xyz-opensource-files-test",
      region: "us-east-1",
      config: { profile: "files-sync" },
      machine_id: machine.id,
    });
    updateSource(source.id, {
      config: { profile: "files-sync-2" },
    });
    updateSource(source.id, { enabled: false });

    const events = listKnowledgeSourceOutboxEvents({ source_id: source.id });
    expect(events.map((event) => event.event_type)).toEqual(["source_created", "source_updated", "source_disabled"]);
    expect(events[1]!.metadata).toMatchObject({
      config_changed: true,
      changed_fields: ["config"],
    });
    expect(JSON.stringify(events)).not.toContain("do-not-store-this");
    expect(JSON.stringify(events)).not.toContain("files-sync-2");
  });

  test("emits permission_changed events from organization ACL review updates", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { upsertFile } = await import("./files.js");
    const { upsertGoogleDriveImportedObject } = await import("./google-drive.js");
    const {
      bootstrapGoogleDriveOrganizationQueues,
      listFileOrganizationReviews,
      updateFileOrganizationReview,
    } = await import("./organization.js");
    const { listKnowledgeSourceOutboxEvents } = await import("./knowledge-outbox.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Google Drive",
      type: "google_drive",
      config: {
        profile: "test",
        include_my_drive: true,
        include_all_shared_drives: true,
      },
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_acl_outbox",
      source_id: source.id,
      machine_id: machine.id,
      path: "google-drive/test/my-drive/legal/contract.txt",
      name: "contract.txt",
      ext: ".txt",
      size: 10,
      mime: "text/plain",
      hash: "c".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });
    upsertGoogleDriveImportedObject({
      source_id: source.id,
      drive_id: "my-drive",
      file_id: "drive-acl-file",
      profile: "test",
      path: "legal/contract.txt",
      name: "contract.txt",
      mime: "text/plain",
      size: 10,
      storage_type: "s3",
      storage_key: "objects/sha256/cc/cc/content",
      s3_key: "google-drive/test/my-drive/legal/contract.txt",
      raw_bucket: "legacy",
      raw_key: "google-drive/test/my-drive/legal/contract.txt",
      canonical_bucket: "canonical",
      canonical_key: "objects/sha256/cc/cc/content",
      canonical_sha256: "c".repeat(64),
      promotion_status: "mapped",
      file_record_id: file.id,
      deleted: false,
      last_imported_at: "2026-06-09T00:00:00.000Z",
    });
    bootstrapGoogleDriveOrganizationQueues();
    const review = listFileOrganizationReviews({ limit: 1 })[0]!;

    updateFileOrganizationReview(review.id, {
      acl_review_status: "approved",
      permission_scope: "private",
      permission_risk: "low",
      actor: "test-reviewer",
    });

    const event = listKnowledgeSourceOutboxEvents({
      file_id: file.id,
      event_types: ["permission_changed"],
    })[0];
    expect(event).toMatchObject({
      event_type: "permission_changed",
      file_id: file.id,
      source_id: source.id,
    });
    expect(event?.metadata).toMatchObject({
      review_id: review.id,
      actor: "test-reviewer",
      before: { acl_review_status: "needs_review" },
      after: { acl_review_status: "approved", permission_risk: "low" },
    });
  });

  test("emits acl_revoked when ACL review restricts access", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { upsertFile } = await import("./files.js");
    const { upsertGoogleDriveImportedObject } = await import("./google-drive.js");
    const {
      bootstrapGoogleDriveOrganizationQueues,
      listFileOrganizationReviews,
      updateFileOrganizationReview,
    } = await import("./organization.js");
    const { listKnowledgeSourceOutboxEvents } = await import("./knowledge-outbox.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Google Drive revoke",
      type: "google_drive",
      config: {
        profile: "test",
        include_my_drive: true,
        include_all_shared_drives: true,
      },
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_acl_revoked",
      source_id: source.id,
      machine_id: machine.id,
      path: "google-drive/test/my-drive/legal/revoke.txt",
      name: "revoke.txt",
      ext: ".txt",
      size: 10,
      mime: "text/plain",
      hash: "d".repeat(64),
      status: "active",
    });
    upsertGoogleDriveImportedObject({
      source_id: source.id,
      drive_id: "my-drive",
      file_id: "drive-revoke-file",
      profile: "test",
      path: "legal/revoke.txt",
      name: "revoke.txt",
      mime: "text/plain",
      size: 10,
      storage_type: "s3",
      storage_key: "objects/sha256/dd/dd/content",
      s3_key: "google-drive/test/my-drive/legal/revoke.txt",
      raw_bucket: "legacy",
      raw_key: "google-drive/test/my-drive/legal/revoke.txt",
      canonical_bucket: "canonical",
      canonical_key: "objects/sha256/dd/dd/content",
      canonical_sha256: "d".repeat(64),
      promotion_status: "mapped",
      file_record_id: file.id,
      deleted: false,
      last_imported_at: "2026-06-09T00:00:00.000Z",
    });
    bootstrapGoogleDriveOrganizationQueues();
    const review = listFileOrganizationReviews({ limit: 1 })[0]!;

    updateFileOrganizationReview(review.id, {
      acl_review_status: "restricted",
      permission_scope: "external",
      permission_risk: "high",
    });

    const events = listKnowledgeSourceOutboxEvents({
      file_id: file.id,
      event_types: ["permission_changed", "acl_revoked"],
    });
    expect(events.map((event) => event.event_type)).toEqual(["permission_changed", "acl_revoked"]);
  });
});

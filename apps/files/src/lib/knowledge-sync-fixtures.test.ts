import { describe, expect, test } from "bun:test";
import {
  buildKnowledgeSyncFixtureManifest,
  buildKnowledgeSyncFixtureOutboxEvents,
  buildKnowledgeSyncFixturePack,
  formatKnowledgeSyncFixtureJsonl,
  KNOWLEDGE_SYNC_FIXTURE_CASES,
} from "./knowledge-sync-fixtures.js";

describe("knowledge sync fixtures", () => {
  test("cover duplicate hashes, stale revisions, deletion, ACL revocation, extraction failures, and path moves", () => {
    const pack = buildKnowledgeSyncFixturePack();
    expect(KNOWLEDGE_SYNC_FIXTURE_CASES.map((entry) => entry.case).sort()).toEqual([
      "acl_revoked",
      "deleted_source",
      "duplicate_hash",
      "extraction_failed",
      "renamed_path",
      "stale_revision",
    ]);

    const duplicateHashItems = pack.current_manifest.items.filter(
      (item) => item.hash === "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    );
    expect(duplicateHashItems.map((item) => item.file_id).sort()).toEqual([
      "f_fixture_duplicate_a",
      "f_fixture_duplicate_b",
    ]);
    expect(new Set(pack.current_manifest.items.map((item) => item.open_files_root.machine.hostname))).toEqual(
      new Set(["linux-node-a", "linux-node-b"]),
    );
    for (const item of pack.current_manifest.items) {
      expect(item.open_files_root.open_files_root).toMatch(/^open-files:\/\/source\/src_fixture_drive_linux-node-[ab]$/);
      expect(item.open_files_root.evidence_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(item.open_files_root.s3).toMatchObject({
        bucket: "example-files-bucket",
        prefix: "fixtures/knowledge-sync",
        region: "us-east-1",
      });
    }

    const deleted = pack.current_manifest.items.find((item) => item.file_id === "f_fixture_deleted");
    expect(deleted).toMatchObject({ status: "deleted", deleted: true, tombstone: true });

    const acl = pack.current_manifest.items.find((item) => item.file_id === "f_fixture_acl");
    expect(acl?.permissions).toMatchObject({
      mode: "read_only",
      allowed_purposes: [],
      denied_purposes: ["knowledge_index", "knowledge_answer", "agent_context"],
    });
    expect(acl?.acl_summary).toMatchObject({ acl_review_status: "restricted", permission_risk: "high" });

    const extractionFailed = pack.current_manifest.items.find((item) => item.file_id === "f_fixture_extract_failed");
    expect(extractionFailed?.extraction).toMatchObject({
      text_available: false,
      status: "error",
      status_reason: "unsupported_encrypted_pdf",
    });

    expect(pack.outbox_events.map((event) => event.event_type)).toEqual([
      "deleted",
      "revision_changed",
      "acl_revoked",
      "extraction_failed",
      "moved",
    ]);
    expect(pack.outbox_events[1]).toMatchObject({
      event_type: "revision_changed",
      previous_revision_id: "rev_fixture_stale_before",
      revision_id: "rev_fixture_stale_after",
    });
    expect(pack.outbox_events[4]?.metadata).toMatchObject({
      previous_path: "google-drive/example/shared-drive/knowledge/old-name.md",
      canonical_key_changed: true,
    });
  });

  test("formats deterministic JSONL for manifest and outbox consumers", () => {
    const manifest = buildKnowledgeSyncFixtureManifest("current");
    const outbox = buildKnowledgeSyncFixtureOutboxEvents();

    const manifestJsonl = formatKnowledgeSyncFixtureJsonl(manifest.items);
    const outboxJsonl = formatKnowledgeSyncFixtureJsonl(outbox);

    expect(manifestJsonl.split("\n").filter(Boolean)).toHaveLength(manifest.items.length);
    expect(outboxJsonl.split("\n").filter(Boolean)).toHaveLength(outbox.length);
    expect(JSON.parse(manifestJsonl.split("\n")[0]!)).toMatchObject({
      kind: "file",
      permissions: { mode: "read_only" },
    });
    expect(JSON.parse(outboxJsonl.split("\n")[1]!)).toMatchObject({
      event: "revision_changed",
      event_type: "revision_changed",
      previous_revision_id: "rev_fixture_stale_before",
    });
  });
});

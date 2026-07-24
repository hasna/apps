import { createHash } from "node:crypto";
import type {
  FileStatus,
  KnowledgeSourceManifest,
  KnowledgeSourceManifestFileItem,
  KnowledgeSourceOutboxEvent,
  KnowledgeSourceOutboxEventType,
} from "../types/index.js";

export type KnowledgeSyncFixtureCase =
  | "duplicate_hash"
  | "stale_revision"
  | "deleted_source"
  | "acl_revoked"
  | "extraction_failed"
  | "renamed_path";

export interface KnowledgeSyncFixtureCaseSummary {
  case: KnowledgeSyncFixtureCase;
  file_ids: string[];
  proves: string;
}

export interface KnowledgeSyncFixtureManifestItem extends KnowledgeSourceManifestFileItem {
  extracted_text?: string;
}

export interface KnowledgeSyncFixtureManifest extends Omit<KnowledgeSourceManifest, "items"> {
  items: KnowledgeSyncFixtureManifestItem[];
}

export interface KnowledgeSyncFixtureOutboxEvent extends KnowledgeSourceOutboxEvent {
  event: KnowledgeSourceOutboxEventType;
  type: KnowledgeSourceOutboxEventType;
  updated_at: string;
  permissions?: {
    mode: "read_only";
    allowed_purposes: string[];
    denied_purposes?: string[];
  };
}

export interface KnowledgeSyncFixturePack {
  generated_at: string;
  cases: KnowledgeSyncFixtureCaseSummary[];
  baseline_manifest: KnowledgeSyncFixtureManifest;
  current_manifest: KnowledgeSyncFixtureManifest;
  outbox_events: KnowledgeSyncFixtureOutboxEvent[];
  baseline_manifest_jsonl: string;
  current_manifest_jsonl: string;
  outbox_jsonl: string;
}

const GENERATED_AT = "2026-06-09T00:00:00.000Z";
const SOURCE_ID_NODE_A = "src_fixture_drive_linux-node-a";
const SOURCE_ID_NODE_B = "src_fixture_drive_linux-node-b";
const SOURCE_NAME = "Knowledge sync fixture Drive";
const DEFAULT_PURPOSES = ["knowledge_index", "knowledge_answer", "agent_context"];
const NO_PURPOSES: string[] = [];
type FixtureAclSummary = NonNullable<KnowledgeSyncFixtureManifestItem["acl_summary"]>;
type FixturePermissions = KnowledgeSyncFixtureManifestItem["permissions"] & { denied_purposes?: string[] };
type FixtureMachine = "linux-node-a" | "linux-node-b";

const FIXTURE_MACHINES: Record<FixtureMachine, KnowledgeSyncFixtureManifestItem["open_files_root"]["machine"]> = {
  "linux-node-a": {
    machine_id: "m_fixture_linux-node-a",
    name: "linux-node-a",
    hostname: "linux-node-a",
    platform: "linux",
    arch: "x64",
    is_current: false,
  },
  "linux-node-b": {
    machine_id: "m_fixture_linux-node-b",
    name: "linux-node-b",
    hostname: "linux-node-b",
    platform: "linux",
    arch: "x64",
    is_current: false,
  },
};

export const KNOWLEDGE_SYNC_FIXTURE_CASES: KnowledgeSyncFixtureCaseSummary[] = [
  {
    case: "duplicate_hash",
    file_ids: ["f_fixture_duplicate_a", "f_fixture_duplicate_b"],
    proves: "Consumers must keep source identity separate from content hash identity.",
  },
  {
    case: "stale_revision",
    file_ids: ["f_fixture_stale"],
    proves: "A revision_changed event with previous_revision_id invalidates old chunks and citations.",
  },
  {
    case: "deleted_source",
    file_ids: ["f_fixture_deleted"],
    proves: "Deleted manifests and outbox events remove source chunks and mark tombstones.",
  },
  {
    case: "acl_revoked",
    file_ids: ["f_fixture_acl"],
    proves: "ACL revocation removes chunks and denies knowledge purposes without exposing source bytes.",
  },
  {
    case: "extraction_failed",
    file_ids: ["f_fixture_extract_failed"],
    proves: "Extraction failures keep metadata visible while withholding chunk text.",
  },
  {
    case: "renamed_path",
    file_ids: ["f_fixture_renamed"],
    proves: "Path moves invalidate stale path citations and preserve the durable open-files ref.",
  },
];

export function buildKnowledgeSyncFixturePack(): KnowledgeSyncFixturePack {
  const baseline = buildKnowledgeSyncFixtureManifest("baseline");
  const current = buildKnowledgeSyncFixtureManifest("current");
  const outbox = buildKnowledgeSyncFixtureOutboxEvents();
  return {
    generated_at: GENERATED_AT,
    cases: KNOWLEDGE_SYNC_FIXTURE_CASES,
    baseline_manifest: baseline,
    current_manifest: current,
    outbox_events: outbox,
    baseline_manifest_jsonl: formatKnowledgeSyncFixtureJsonl(baseline.items),
    current_manifest_jsonl: formatKnowledgeSyncFixtureJsonl(current.items),
    outbox_jsonl: formatKnowledgeSyncFixtureJsonl(outbox),
  };
}

export function buildKnowledgeSyncFixtureManifest(
  phase: "baseline" | "current" = "current",
): KnowledgeSyncFixtureManifest {
  const items = phase === "baseline" ? baselineManifestItems() : currentManifestItems();
  return {
    manifest_id: `manifest_knowledge_sync_fixture_${phase}`,
    generated_at: GENERATED_AT,
    format: "jsonl",
    filters: {
      fixture: "knowledge_sync_edge_cases",
      phase,
      include_deleted: phase === "current",
      include_acl_summary: true,
    },
    item_count: items.length,
    delta: phase === "current",
    high_watermark: phase === "baseline" ? 1 : 2,
    delta_cursor: Buffer.from(JSON.stringify({
      sync_version: phase === "baseline" ? 1 : 2,
      file_id: "",
      high_watermark: phase === "baseline" ? 1 : 2,
    }), "utf8").toString("base64url"),
    tombstone_count: items.filter((item) => item.tombstone).length,
    items,
  };
}

export function buildKnowledgeSyncFixtureOutboxEvents(): KnowledgeSyncFixtureOutboxEvent[] {
  return [
    outboxEvent({
      cursor: 1,
      event_type: "deleted",
      file_id: "f_fixture_deleted",
      revision_id: "rev_fixture_deleted_before",
      status: "deleted",
      path: "google-drive/example/my-drive/archive/delete-me.md",
      hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      metadata: { reason: "fixture_deleted_source" },
    }),
    outboxEvent({
      cursor: 2,
      event_type: "revision_changed",
      file_id: "f_fixture_stale",
      revision_id: "rev_fixture_stale_after",
      previous_revision_id: "rev_fixture_stale_before",
      status: "active",
      path: "google-drive/example/shared-drive/knowledge/current-policy.md",
      hash: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      metadata: {
        reason: "fixture_stale_revision",
        previous_hash: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      },
    }),
    outboxEvent({
      cursor: 3,
      event_type: "acl_revoked",
      file_id: "f_fixture_acl",
      revision_id: "rev_fixture_acl_before",
      status: "active",
      path: "google-drive/example/shared-drive/legal/restricted-brief.md",
      hash: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
      permissions: restrictedPermissions(),
      metadata: { reason: "fixture_acl_revoked", acl_review_status: "restricted", permission_risk: "high" },
    }),
    outboxEvent({
      cursor: 4,
      event_type: "extraction_failed",
      file_id: "f_fixture_extract_failed",
      revision_id: "rev_fixture_extract_failed",
      status: "active",
      path: "google-drive/example/shared-drive/product/failed-extraction.pdf",
      hash: "sha256:6666666666666666666666666666666666666666666666666666666666666666",
      metadata: { reason: "fixture_extraction_failed", extractor: "fixture", error_code: "unsupported_encrypted_pdf" },
    }),
    outboxEvent({
      cursor: 5,
      event_type: "moved",
      file_id: "f_fixture_renamed",
      revision_id: "rev_fixture_renamed_after",
      previous_revision_id: "rev_fixture_renamed_before",
      status: "moved",
      path: "google-drive/example/shared-drive/knowledge/renamed/current-name.md",
      hash: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
      metadata: {
        reason: "fixture_renamed_path",
        previous_path: "google-drive/example/shared-drive/knowledge/old-name.md",
        canonical_key_changed: true,
      },
    }),
  ];
}

export function formatKnowledgeSyncFixtureJsonl(rows: object[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}

function baselineManifestItems(): KnowledgeSyncFixtureManifestItem[] {
  return [
    fileItem({
      caseName: "duplicate_hash",
      fileId: "f_fixture_duplicate_a",
      revisionId: "rev_fixture_duplicate_a",
      path: "google-drive/example/shared-drive/finance/duplicate-a.md",
      name: "duplicate-a.md",
      hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      machine: "linux-node-a",
      text: "Duplicate hash fixture alpha content. This source must remain distinct from duplicate beta.",
    }),
    fileItem({
      caseName: "duplicate_hash",
      fileId: "f_fixture_duplicate_b",
      revisionId: "rev_fixture_duplicate_b",
      path: "google-drive/example/shared-drive/finance/duplicate-b.md",
      name: "duplicate-b.md",
      hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      machine: "linux-node-b",
      text: "Duplicate hash fixture beta content. This source must remain distinct from duplicate alpha.",
    }),
    fileItem({
      caseName: "deleted_source",
      fileId: "f_fixture_deleted",
      revisionId: "rev_fixture_deleted_before",
      path: "google-drive/example/my-drive/archive/delete-me.md",
      name: "delete-me.md",
      hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      machine: "linux-node-a",
      text: "Deleted source fixture text. This must disappear from search and citations after outbox consumption.",
    }),
    fileItem({
      caseName: "stale_revision",
      fileId: "f_fixture_stale",
      revisionId: "rev_fixture_stale_before",
      path: "google-drive/example/shared-drive/knowledge/current-policy.md",
      name: "current-policy.md",
      hash: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
      machine: "linux-node-b",
      text: "Stale revision fixture old policy text. This must not survive a revision_changed event.",
    }),
    fileItem({
      caseName: "acl_revoked",
      fileId: "f_fixture_acl",
      revisionId: "rev_fixture_acl_before",
      path: "google-drive/example/shared-drive/legal/restricted-brief.md",
      name: "restricted-brief.md",
      hash: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
      machine: "linux-node-a",
      text: "ACL revoked fixture confidential brief. This must not appear after access is revoked.",
    }),
    fileItem({
      caseName: "renamed_path",
      fileId: "f_fixture_renamed",
      revisionId: "rev_fixture_renamed_before",
      path: "google-drive/example/shared-drive/knowledge/old-name.md",
      name: "old-name.md",
      hash: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
      machine: "linux-node-b",
      text: "Renamed path fixture old path text. This must be invalidated after the move event.",
    }),
  ];
}

function currentManifestItems(): KnowledgeSyncFixtureManifestItem[] {
  return [
    ...baselineManifestItems().filter((item) => item.file_id.startsWith("f_fixture_duplicate")),
    fileItem({
      caseName: "deleted_source",
      fileId: "f_fixture_deleted",
      revisionId: "rev_fixture_deleted_before",
      path: "google-drive/example/my-drive/archive/delete-me.md",
      name: "delete-me.md",
      hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      status: "deleted",
      deleted: true,
      tombstone: true,
      permissions: restrictedPermissions(),
      extractionStatus: "unsupported",
      machine: "linux-node-a",
    }),
    fileItem({
      caseName: "stale_revision",
      fileId: "f_fixture_stale",
      revisionId: "rev_fixture_stale_after",
      path: "google-drive/example/shared-drive/knowledge/current-policy.md",
      name: "current-policy.md",
      hash: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      text: "Current revision fixture replacement policy text. This may be indexed after stale chunks are invalidated.",
      syncVersion: 2,
      machine: "linux-node-b",
    }),
    fileItem({
      caseName: "acl_revoked",
      fileId: "f_fixture_acl",
      revisionId: "rev_fixture_acl_before",
      path: "google-drive/example/shared-drive/legal/restricted-brief.md",
      name: "restricted-brief.md",
      hash: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
      permissions: restrictedPermissions(),
      aclStatus: "restricted",
      permissionRisk: "high",
      extractionStatus: "unsupported",
      machine: "linux-node-a",
    }),
    fileItem({
      caseName: "extraction_failed",
      fileId: "f_fixture_extract_failed",
      revisionId: "rev_fixture_extract_failed",
      path: "google-drive/example/shared-drive/product/failed-extraction.pdf",
      name: "failed-extraction.pdf",
      hash: "sha256:6666666666666666666666666666666666666666666666666666666666666666",
      mime: "application/pdf",
      extractionStatus: "error",
      extractionStatusReason: "unsupported_encrypted_pdf",
      syncVersion: 2,
      machine: "linux-node-b",
    }),
    fileItem({
      caseName: "renamed_path",
      fileId: "f_fixture_renamed",
      revisionId: "rev_fixture_renamed_after",
      path: "google-drive/example/shared-drive/knowledge/renamed/current-name.md",
      name: "current-name.md",
      hash: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
      text: "Renamed path fixture current path text. This may be indexed after the old path citation is invalidated.",
      status: "moved",
      syncVersion: 2,
      machine: "linux-node-b",
    }),
  ];
}

function fileItem(input: {
  caseName: KnowledgeSyncFixtureCase;
  fileId: string;
  revisionId: string;
  path: string;
  name: string;
  hash: string;
  text?: string;
  mime?: string;
  status?: FileStatus;
  deleted?: boolean;
  tombstone?: boolean;
  permissions?: FixturePermissions;
  aclStatus?: FixtureAclSummary["acl_review_status"];
  permissionRisk?: FixtureAclSummary["permission_risk"];
  extractionStatus?: KnowledgeSyncFixtureManifestItem["extraction"]["status"];
  extractionStatusReason?: string;
  syncVersion?: number;
  machine?: FixtureMachine;
}): KnowledgeSyncFixtureManifestItem {
  const status = input.status ?? "active";
  const textAvailable = Boolean(input.text);
  const machineName = input.machine ?? "linux-node-a";
  const machine = FIXTURE_MACHINES[machineName];
  const sourceId = machineName === "linux-node-a" ? SOURCE_ID_NODE_A : SOURCE_ID_NODE_B;
  return {
    kind: "file",
    source_ref: `open-files://file/${input.fileId}`,
    revision_ref: `open-files://file/${input.fileId}/revision/${input.revisionId}`,
    revision_id: input.revisionId,
    sync_version: input.syncVersion ?? 1,
    source_revision_hash: input.hash,
    file_id: input.fileId,
    source_id: sourceId,
    source_name: SOURCE_NAME,
    source_type: "google_drive",
    path: input.path,
    name: input.name,
    mime: input.mime ?? "text/markdown",
    size: input.text ? Buffer.byteLength(input.text) : 0,
    hash: input.hash,
    status,
    updated_at: GENERATED_AT,
    deleted: input.deleted ?? status === "deleted",
    tombstone: input.tombstone,
    tags: ["knowledge-sync-fixture", input.caseName],
    open_files_root: {
      open_files_root: `open-files://source/${sourceId}`,
      source_id: sourceId,
      source_type: "google_drive",
      source_path: input.path,
      machine,
      s3: {
        bucket: "example-files-bucket",
        prefix: "fixtures/knowledge-sync",
        region: "us-east-1",
      },
      evidence_hash: fixtureRootEvidenceHash(sourceId, input.path, machine.machine_id),
    },
    storage: {
      provider: "s3",
      source_id: sourceId,
      bucket: "example-files-bucket",
      key: `fixtures/knowledge-sync/${input.fileId}/${input.revisionId}`,
      region: "us-east-1",
    },
    extraction: {
      text_available: textAvailable,
      status: input.extractionStatus ?? (textAvailable ? "available" : "unsupported"),
      extracted_text_ref: textAvailable ? `open-files://file/${input.fileId}/revision/${input.revisionId}/extracted-text` : undefined,
      status_reason: input.extractionStatusReason,
    },
    permissions: input.permissions ?? {
      mode: "read_only",
      allowed_purposes: DEFAULT_PURPOSES,
    },
    acl_summary: {
      review_id: `review_${input.fileId}`,
      owner: "knowledge",
      review_status: "in_review",
      acl_review_status: input.aclStatus ?? "approved",
      permission_scope: input.aclStatus === "restricted" ? "external" : "private",
      permission_risk: input.permissionRisk ?? "low",
      target_path: input.path,
      updated_at: GENERATED_AT,
    },
    permission_labels: [
      "read_only",
      "source_enabled",
      "source_type:google_drive",
      "storage:s3",
      `status:${status}`,
      `fixture:${input.caseName}`,
    ],
    extracted_text: input.text,
  };
}

function outboxEvent(input: {
  cursor: number;
  event_type: KnowledgeSourceOutboxEventType;
  file_id: string;
  revision_id: string;
  previous_revision_id?: string;
  status: FileStatus | string;
  path: string;
  hash: string;
  permissions?: KnowledgeSyncFixtureOutboxEvent["permissions"];
  metadata?: Record<string, unknown>;
}): KnowledgeSyncFixtureOutboxEvent {
  const sourceId = fixtureSourceId(input.file_id);
  return {
    id: `out_fixture_${String(input.cursor).padStart(2, "0")}`,
    cursor: input.cursor,
    event_type: input.event_type,
    event: input.event_type,
    type: input.event_type,
    source_ref: `open-files://file/${input.file_id}/revision/${input.revision_id}`,
    file_id: input.file_id,
    source_id: sourceId,
    revision_id: input.revision_id,
    previous_revision_id: input.previous_revision_id,
    status: input.status,
    hash: input.hash,
    size: 0,
    mime: "text/markdown",
    path: input.path,
    idempotency_key: `fixture:${input.event_type}:${input.file_id}:${input.previous_revision_id ?? ""}:${input.revision_id}`,
    metadata: input.metadata ?? {},
    created_at: GENERATED_AT,
    updated_at: GENERATED_AT,
    permissions: input.permissions,
  };
}

function fixtureSourceId(fileId: string): string {
  return fileId.includes("duplicate_b")
    || fileId.includes("stale")
    || fileId.includes("extract_failed")
    || fileId.includes("renamed")
    ? SOURCE_ID_NODE_B
    : SOURCE_ID_NODE_A;
}

function fixtureRootEvidenceHash(sourceId: string, sourcePath: string, machineId: string): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({ sourceId, sourcePath, machineId })).digest("hex")}`;
}

function restrictedPermissions(): KnowledgeSyncFixtureOutboxEvent["permissions"] {
  return {
    mode: "read_only",
    allowed_purposes: NO_PURPOSES,
    denied_purposes: DEFAULT_PURPOSES,
  };
}

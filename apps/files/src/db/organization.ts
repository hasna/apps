import { getDb } from "./database.js";
import { nanoid } from "nanoid";
import { getLatestFileVersion } from "./file-versions.js";
import { refreshFileFts } from "./files.js";
import { appendKnowledgeSourceOutboxEvent } from "./knowledge-outbox.js";
import { buildOpenFilesFileRef } from "../lib/source-ref.js";
import type {
  FileOrganizationEvent,
  FileOrganizationAclReviewStatus,
  FileOrganizationApprovalPacket,
  FileOrganizationApprovalPacketRow,
  FileOrganizationAuditExport,
  FileOrganizationAuditExportEvent,
  FileOrganizationAuditExportFormat,
  FileOrganizationAuditExportRow,
  FileOrganizationDuplicateGroupRow,
  FileOrganizationDuplicateGroupSummary,
  GoogleDriveUnifiedOrganizationPolicyResult,
  FileOrganizationPermissionRisk,
  FileOrganizationPermissionScope,
  FileOrganizationReview,
  FileOrganizationReviewStatus,
  FileOrganizationReviewWithFile,
  FileOrganizationRootType,
  FileOrganizationStats,
  FileOrganizationUnassignedGroupRow,
  FileOrganizationUnassignedGroupSummary,
  GoogleDriveOrganizationInferenceResult,
  GoogleDriveOrganizationBootstrapResult,
} from "../types/index.js";

interface ReviewRow {
  id: string;
  file_id: string;
  source_id: string;
  profile: string | null;
  drive_id: string | null;
  root_type: string;
  original_path: string;
  current_path: string;
  target_path: string | null;
  target_collection_id: string | null;
  target_project_id: string | null;
  owner: string | null;
  acl_review_status: string;
  permission_scope: string;
  permission_risk: string;
  permission_notes: string | null;
  permissions_metadata: string;
  labels: string;
  duplicate_group_id: string | null;
  review_status: string;
  priority: string;
  reviewer: string | null;
  reviewed_at: string | null;
  notes: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  review_id: string;
  file_id: string;
  action: string;
  actor: string | null;
  from_status: string | null;
  to_status: string | null;
  before_state: string | null;
  after_state: string | null;
  note: string | null;
  created_at: string;
}

interface DriveImportRow {
  file_record_id: string;
  source_id: string;
  drive_id: string;
  profile: string | null;
  path: string;
  name: string;
  raw_key: string | null;
  canonical_bucket: string | null;
  canonical_key: string | null;
  canonical_sha256: string | null;
  file_name: string;
  file_size: number;
  file_mime: string;
}

interface AuditExportRow {
  review_id: string;
  file_id: string;
  file_name: string;
  file_size: number;
  file_mime: string;
  profile: string | null;
  drive_id: string | null;
  root_type: string;
  original_path: string;
  current_path: string;
  target_path: string | null;
  owner: string | null;
  review_status: string;
  acl_review_status: string;
  permission_scope: string;
  permission_risk: string;
  duplicate_group_id: string | null;
  canonical_bucket: string | null;
  canonical_key: string | null;
  canonical_sha256: string | null;
  updated_at: string;
}

interface AuditExportEventRow {
  id: string;
  review_id: string;
  file_id: string;
  file_name: string | null;
  action: string;
  actor: string | null;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string;
}

interface DuplicateReviewRow extends ReviewRow {
  file_name: string;
  file_size: number;
  file_mime: string;
  file_modified_at?: string | null;
  file_indexed_at?: string | null;
}

interface UnassignedReviewRow extends ReviewRow {
  file_name: string;
  file_size: number;
  file_mime: string;
}

interface ApprovalPacketReviewRow extends ReviewRow {
  file_name: string;
  file_size: number;
  file_mime: string;
}

interface UnifiedDrivePolicyRow extends ReviewRow {
  file_name: string;
  file_size: number;
  file_mime: string;
  file_modified_at: string | null;
  file_indexed_at: string | null;
}

interface UnifiedDriveCandidate {
  owner: string;
  target_path: string;
  labels: string[];
  top_level: string;
  policy_track: string;
}

interface UnifiedDrivePlanItem {
  row: UnifiedDrivePolicyRow;
  candidate: UnifiedDriveCandidate;
  status: FileOrganizationReviewStatus;
  is_duplicate_survivor: boolean;
}

const REVIEW_STATUSES = new Set<FileOrganizationReviewStatus>([
  "unreviewed",
  "in_review",
  "approved",
  "moved",
  "duplicate",
  "ignored",
]);

const ACL_REVIEW_STATUSES = new Set<FileOrganizationAclReviewStatus>([
  "needs_review",
  "approved",
  "restricted",
  "external_review",
  "unknown",
]);

const PERMISSION_SCOPES = new Set<FileOrganizationPermissionScope>([
  "unknown",
  "private",
  "domain",
  "shared_drive",
  "external",
  "public",
  "mixed",
]);

const PERMISSION_RISKS = new Set<FileOrganizationPermissionRisk>([
  "unknown",
  "low",
  "medium",
  "high",
]);

const ROOT_LABELS: Record<FileOrganizationRootType, string> = {
  my_drive: "My Drive",
  shared_drive: "Shared Drives",
  unknown: "Unknown Root",
};

const SHARED_DRIVE_OWNER_BY_TOP_LEVEL: Record<string, string> = {
  Product: "product",
  Finance: "finance",
  People: "people",
  Legal: "legal",
  Workspace: "workspace",
  "Marketing & Sales": "marketing-sales",
};

const MY_DRIVE_OWNER_BY_TOP_LEVEL: Record<string, { owner: string; labels: string[] }> = {
  "HR & People": { owner: "people", labels: ["people"] },
  Finance: { owner: "finance", labels: ["finance"] },
  "Business Operations": { owner: "workspace", labels: ["workspace", "business-operations"] },
  "Content & Marketing": { owner: "marketing-sales", labels: ["marketing-sales", "content-marketing"] },
  Shootings: { owner: "marketing-sales", labels: ["marketing-sales", "media-production"] },
  "Beep Media Deliverables": { owner: "marketing-sales", labels: ["marketing-sales", "beep-media", "deliverables"] },
  "MW VisiSharp German Content - Beep Media": { owner: "marketing-sales", labels: ["marketing-sales", "beep-media", "content-marketing"] },
  "Creatives Examples": { owner: "marketing-sales", labels: ["marketing-sales", "creative"] },
};

const UNIFIED_DRIVE_TOP_LEVEL_POLICY: Record<string, {
  owner: string;
  target_root: string;
  labels: string[];
  policy_track: string;
}> = {
  Product: { owner: "product", target_root: "product", labels: ["product"], policy_track: "business-owner" },
  Finance: { owner: "finance", target_root: "finance", labels: ["finance"], policy_track: "business-owner" },
  People: { owner: "people", target_root: "people", labels: ["people"], policy_track: "business-owner" },
  Legal: { owner: "legal", target_root: "legal", labels: ["legal"], policy_track: "business-owner" },
  Workspace: { owner: "workspace", target_root: "workspace", labels: ["workspace"], policy_track: "business-owner" },
  "Marketing & Sales": { owner: "marketing-sales", target_root: "marketing-sales", labels: ["marketing-sales"], policy_track: "business-owner" },
  "HR & People": { owner: "people", target_root: "people", labels: ["people"], policy_track: "my-drive-business-owner" },
  "Business Operations": { owner: "workspace", target_root: "workspace/business-operations", labels: ["workspace", "business-operations"], policy_track: "my-drive-business-owner" },
  "Content & Marketing": { owner: "marketing-sales", target_root: "marketing-sales/content-marketing", labels: ["marketing-sales", "content-marketing"], policy_track: "my-drive-business-owner" },
  Shootings: { owner: "marketing-sales", target_root: "marketing-sales/media-production/shootings", labels: ["marketing-sales", "media-production"], policy_track: "my-drive-business-owner" },
  "Beep Media Deliverables": { owner: "marketing-sales", target_root: "marketing-sales/beep-media/deliverables", labels: ["marketing-sales", "beep-media", "deliverables"], policy_track: "my-drive-business-owner" },
  "MW VisiSharp German Content - Beep Media": { owner: "marketing-sales", target_root: "marketing-sales/beep-media/content-marketing", labels: ["marketing-sales", "beep-media", "content-marketing"], policy_track: "my-drive-business-owner" },
  "Creatives Examples": { owner: "marketing-sales", target_root: "marketing-sales/creative-examples", labels: ["marketing-sales", "creative"], policy_track: "my-drive-business-owner" },
  "USB and External Devices": { owner: "archive", target_root: "archive/external-devices", labels: ["archive", "external-devices"], policy_track: "external-device-archive" },
  Archive: { owner: "archive", target_root: "archive", labels: ["archive"], policy_track: "archive" },
  "Signed Affidavit and Testimonials": { owner: "legal", target_root: "legal/review/affidavits-testimonials", labels: ["legal", "legal-review"], policy_track: "legal-review" },
  "Pentru Diana & Andrei": { owner: "personal-review", target_root: "personal-review/diana-andrei", labels: ["personal-review"], policy_track: "personal-review" },
  "Hasna (3)": { owner: "personal-review", target_root: "personal-review/hasna-3", labels: ["personal-review"], policy_track: "personal-review" },
  Hasna: { owner: "personal-review", target_root: "personal-review/hasna", labels: ["personal-review"], policy_track: "personal-review" },
};

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toReview(row: ReviewRow): FileOrganizationReview {
  return {
    ...row,
    profile: row.profile ?? undefined,
    drive_id: row.drive_id ?? undefined,
    root_type: row.root_type as FileOrganizationRootType,
    target_path: row.target_path ?? undefined,
    target_collection_id: row.target_collection_id ?? undefined,
    target_project_id: row.target_project_id ?? undefined,
    owner: row.owner ?? undefined,
    acl_review_status: row.acl_review_status as FileOrganizationAclReviewStatus,
    permission_scope: row.permission_scope as FileOrganizationPermissionScope,
    permission_risk: row.permission_risk as FileOrganizationPermissionRisk,
    permission_notes: row.permission_notes ?? undefined,
    permissions_metadata: parseJson<Record<string, unknown>>(row.permissions_metadata, {}),
    labels: parseJson<string[]>(row.labels, []),
    duplicate_group_id: row.duplicate_group_id ?? undefined,
    review_status: row.review_status as FileOrganizationReviewStatus,
    reviewer: row.reviewer ?? undefined,
    reviewed_at: row.reviewed_at ?? undefined,
    notes: row.notes ?? undefined,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
  };
}

function toEvent(row: EventRow): FileOrganizationEvent {
  return {
    ...row,
    actor: row.actor ?? undefined,
    from_status: row.from_status as FileOrganizationReviewStatus | null ?? undefined,
    to_status: row.to_status as FileOrganizationReviewStatus | null ?? undefined,
    before_state: parseJson<Record<string, unknown> | undefined>(row.before_state, undefined),
    after_state: parseJson<Record<string, unknown> | undefined>(row.after_state, undefined),
    note: row.note ?? undefined,
  };
}

function normalizeStatus(status: string): FileOrganizationReviewStatus {
  if (!REVIEW_STATUSES.has(status as FileOrganizationReviewStatus)) {
    throw new Error(`Invalid review status: ${status}`);
  }
  return status as FileOrganizationReviewStatus;
}

function normalizeAclReviewStatus(status: string): FileOrganizationAclReviewStatus {
  if (!ACL_REVIEW_STATUSES.has(status as FileOrganizationAclReviewStatus)) {
    throw new Error(`Invalid ACL review status: ${status}`);
  }
  return status as FileOrganizationAclReviewStatus;
}

function normalizePermissionScope(scope: string): FileOrganizationPermissionScope {
  if (!PERMISSION_SCOPES.has(scope as FileOrganizationPermissionScope)) {
    throw new Error(`Invalid permission scope: ${scope}`);
  }
  return scope as FileOrganizationPermissionScope;
}

function normalizePermissionRisk(risk: string): FileOrganizationPermissionRisk {
  if (!PERMISSION_RISKS.has(risk as FileOrganizationPermissionRisk)) {
    throw new Error(`Invalid permission risk: ${risk}`);
  }
  return risk as FileOrganizationPermissionRisk;
}

export function bootstrapGoogleDriveOrganizationQueues(): GoogleDriveOrganizationBootstrapResult {
  const db = getDb();
  const duplicateCounts = new Map<string, number>(
    db.query<{ canonical_sha256: string; count: number }, []>(
      `SELECT canonical_sha256, COUNT(*) as count
       FROM google_drive_imported_objects
       WHERE deleted = 0 AND canonical_sha256 IS NOT NULL AND canonical_sha256 != ''
       GROUP BY canonical_sha256
       HAVING COUNT(*) > 1`,
    ).all().map((row) => [row.canonical_sha256, row.count]),
  );

  const rows = db.query<DriveImportRow, []>(
    `SELECT
       g.file_record_id,
       g.source_id,
       g.drive_id,
       g.profile,
       g.path,
       g.name,
       g.raw_key,
       g.canonical_bucket,
       g.canonical_key,
       g.canonical_sha256,
       f.name as file_name,
       f.size as file_size,
       f.mime as file_mime
     FROM google_drive_imported_objects g
     JOIN files f ON f.id = g.file_record_id
     WHERE g.deleted = 0
     ORDER BY COALESCE(g.profile, ''), g.path, g.file_record_id`,
  ).all();

  let collectionsCreated = 0;
  const result: GoogleDriveOrganizationBootstrapResult = {
    scanned: rows.length,
    created: 0,
    updated: 0,
    duplicate_rows: 0,
    collections_created: 0,
    root_collection_id: "",
  };

  db.transaction(() => {
    db.run(
      `DELETE FROM collection_files
       WHERE collection_id IN (
         SELECT id FROM collections WHERE metadata LIKE '%"role":"review_queue"%'
       )`,
    );

    const rootId = ensureCollection({
      name: "Google Drive Archive Review",
      description: "Imported Google Drive archive review queues",
      metadata: { system: "open-files", role: "google_drive_review_root" },
      onCreate: () => collectionsCreated++,
    });
    result.root_collection_id = rootId;

    const collectionCache = new Map<string, string>();
    for (const row of rows) {
      const profile = row.profile || inferProfile(row.raw_key) || "unknown-profile";
      const rootType = inferRootType(row);
      const aclDefaults = inferAclDefaults(rootType);
      const duplicateGroupId = row.canonical_sha256 && duplicateCounts.has(row.canonical_sha256)
        ? `dup_${row.canonical_sha256.slice(0, 16)}`
        : undefined;
      if (duplicateGroupId) result.duplicate_rows++;

      const profileCollectionId = cachedCollection(collectionCache, `${rootId}:profile:${profile}`, () =>
        ensureCollection({
          name: profile,
          description: `Google Drive profile ${profile}`,
          parent_id: rootId,
          metadata: { system: "open-files", role: "google_drive_profile", profile },
          onCreate: () => collectionsCreated++,
        }));
      const rootCollectionId = cachedCollection(collectionCache, `${profileCollectionId}:root:${rootType}`, () =>
        ensureCollection({
          name: ROOT_LABELS[rootType],
          description: `${ROOT_LABELS[rootType]} files imported from Google Drive`,
          parent_id: profileCollectionId,
          metadata: { system: "open-files", role: "google_drive_root", profile, root_type: rootType },
          onCreate: () => collectionsCreated++,
        }));
      const unclassifiedCollectionId = cachedCollection(collectionCache, `${rootCollectionId}:unclassified`, () =>
        ensureCollection({
          name: "Unclassified",
          description: "Files waiting for owner, destination, and duplicate review",
          parent_id: rootCollectionId,
          metadata: { system: "open-files", role: "review_queue", queue: "unclassified", profile, root_type: rootType },
          onCreate: () => collectionsCreated++,
        }));
      const duplicatesCollectionId = duplicateGroupId
        ? cachedCollection(collectionCache, `${rootCollectionId}:duplicates`, () =>
            ensureCollection({
              name: "Duplicates",
              description: "Files sharing canonical content with another imported Drive row",
              parent_id: rootCollectionId,
              metadata: { system: "open-files", role: "review_queue", queue: "duplicates", profile, root_type: rootType },
              onCreate: () => collectionsCreated++,
            }))
        : undefined;

      const existing = db.query<ReviewRow, [string]>(
        "SELECT * FROM file_organization_reviews WHERE file_id = ?",
      ).get(row.file_record_id);

      const metadata = {
        source: "google_drive_import",
        canonical_bucket: row.canonical_bucket,
        canonical_key: row.canonical_key,
        canonical_sha256: row.canonical_sha256,
        raw_key: row.raw_key,
      };
      const permissionsMetadata = {
        source: "inferred_from_drive_root",
        inference: "Google Drive permission exports are not present in the imported metadata; reviewer must verify effective ACLs before legacy retirement.",
        profile,
        drive_id: row.drive_id,
        root_type: rootType,
      };

      if (existing) {
        db.run(
          `UPDATE file_organization_reviews
           SET source_id = ?,
               profile = ?,
               drive_id = ?,
               root_type = ?,
               original_path = ?,
               current_path = ?,
               duplicate_group_id = ?,
               permission_scope = CASE WHEN permission_scope = 'unknown' THEN ? ELSE permission_scope END,
               permission_risk = CASE WHEN permission_risk = 'unknown' THEN ? ELSE permission_risk END,
               permissions_metadata = ?,
               metadata = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
          [
            row.source_id,
            profile,
            row.drive_id,
            rootType,
            row.path,
            row.path,
            duplicateGroupId ?? null,
            aclDefaults.permission_scope,
            aclDefaults.permission_risk,
            JSON.stringify({ ...parseJson<Record<string, unknown>>(existing.permissions_metadata, {}), ...permissionsMetadata }),
            JSON.stringify({ ...parseJson<Record<string, unknown>>(existing.metadata, {}), ...metadata }),
            existing.id,
          ],
        );
        result.updated++;
      } else {
        const id = `rev_${nanoid(10)}`;
        db.run(
          `INSERT INTO file_organization_reviews (
            id, file_id, source_id, profile, drive_id, root_type, original_path, current_path,
            duplicate_group_id, review_status, priority, acl_review_status, permission_scope,
            permission_risk, labels, permissions_metadata, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unreviewed', 'normal', 'needs_review', ?, ?, '[]', ?, ?)`,
          [
            id,
            row.file_record_id,
            row.source_id,
            profile,
            row.drive_id,
            rootType,
            row.path,
            row.path,
            duplicateGroupId ?? null,
            aclDefaults.permission_scope,
            aclDefaults.permission_risk,
            JSON.stringify(permissionsMetadata),
            JSON.stringify(metadata),
          ],
        );
        result.created++;
      }

      db.run(
        "INSERT OR IGNORE INTO collection_files (collection_id, file_id) VALUES (?, ?)",
        [unclassifiedCollectionId, row.file_record_id],
      );
      if (duplicatesCollectionId) {
        db.run(
          "INSERT OR IGNORE INTO collection_files (collection_id, file_id) VALUES (?, ?)",
          [duplicatesCollectionId, row.file_record_id],
        );
      }
    }
  });

  result.collections_created = collectionsCreated;
  return result;
}

export function getFileOrganizationStats(): FileOrganizationStats {
  const db = getDb();
  const total = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM file_organization_reviews").get()?.count ?? 0;
  const by_status = db.query<{ review_status: FileOrganizationReviewStatus; count: number }, []>(
    "SELECT review_status, COUNT(*) as count FROM file_organization_reviews GROUP BY review_status ORDER BY review_status",
  ).all();
  const by_root_type = db.query<{ root_type: FileOrganizationRootType; count: number }, []>(
    "SELECT root_type, COUNT(*) as count FROM file_organization_reviews GROUP BY root_type ORDER BY root_type",
  ).all();
  const by_acl_status = db.query<{ acl_review_status: FileOrganizationAclReviewStatus; count: number }, []>(
    "SELECT acl_review_status, COUNT(*) as count FROM file_organization_reviews GROUP BY acl_review_status ORDER BY acl_review_status",
  ).all();
  const by_permission_risk = db.query<{ permission_risk: FileOrganizationPermissionRisk; count: number }, []>(
    "SELECT permission_risk, COUNT(*) as count FROM file_organization_reviews GROUP BY permission_risk ORDER BY permission_risk",
  ).all();
  const duplicate_rows = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM file_organization_reviews WHERE duplicate_group_id IS NOT NULL",
  ).get()?.count ?? 0;
  const unassigned_owner = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM file_organization_reviews WHERE owner IS NULL OR owner = ''",
  ).get()?.count ?? 0;
  const missing_target = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM file_organization_reviews WHERE target_path IS NULL AND target_collection_id IS NULL AND target_project_id IS NULL",
  ).get()?.count ?? 0;
  const acl_needs_review = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM file_organization_reviews WHERE acl_review_status IN ('needs_review', 'unknown')",
  ).get()?.count ?? 0;
  const high_risk_permissions = db.query<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM file_organization_reviews WHERE permission_risk = 'high'",
  ).get()?.count ?? 0;

  return { total, by_status, by_root_type, by_acl_status, by_permission_risk, duplicate_rows, unassigned_owner, missing_target, acl_needs_review, high_risk_permissions };
}

export function listFileOrganizationReviews(opts: {
  status?: FileOrganizationReviewStatus;
  root_type?: FileOrganizationRootType;
  owner?: string;
  acl_review_status?: FileOrganizationAclReviewStatus;
  permission_risk?: FileOrganizationPermissionRisk;
  duplicate_only?: boolean;
  limit?: number;
  offset?: number;
} = {}): FileOrganizationReviewWithFile[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.status) { conditions.push("r.review_status = ?"); params.push(normalizeStatus(opts.status)); }
  if (opts.root_type) { conditions.push("r.root_type = ?"); params.push(opts.root_type); }
  if (opts.owner) { conditions.push("r.owner = ?"); params.push(opts.owner); }
  if (opts.acl_review_status) { conditions.push("r.acl_review_status = ?"); params.push(normalizeAclReviewStatus(opts.acl_review_status)); }
  if (opts.permission_risk) { conditions.push("r.permission_risk = ?"); params.push(normalizePermissionRisk(opts.permission_risk)); }
  if (opts.duplicate_only) conditions.push("r.duplicate_group_id IS NOT NULL");

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = (db.query(
    `SELECT
       r.*,
       f.name as file_name,
       f.size as file_size,
       f.mime as file_mime,
       g.canonical_bucket,
       g.canonical_key,
       g.canonical_sha256
     FROM file_organization_reviews r
     JOIN files f ON f.id = r.file_id
     LEFT JOIN google_drive_imported_objects g ON g.file_record_id = r.file_id AND g.deleted = 0
     ${where}
     ORDER BY
       CASE r.review_status WHEN 'unreviewed' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
       r.updated_at DESC,
       r.original_path ASC
     LIMIT ? OFFSET ?`,
  ) as any).all([...params, opts.limit ?? 50, opts.offset ?? 0]) as Array<ReviewRow & {
    file_name: string;
    file_size: number;
    file_mime: string;
    canonical_bucket: string | null;
    canonical_key: string | null;
    canonical_sha256: string | null;
  }>;

  return rows.map((row) => ({
    ...toReview(row),
    file_name: row.file_name,
    file_size: row.file_size,
    file_mime: row.file_mime,
    canonical_bucket: row.canonical_bucket ?? undefined,
    canonical_key: row.canonical_key ?? undefined,
    canonical_sha256: row.canonical_sha256 ?? undefined,
  }));
}

export function inferGoogleDriveOrganizationCandidates(opts: {
  root_type?: FileOrganizationRootType;
  apply?: boolean;
  limit?: number;
  actor?: string;
} = {}): GoogleDriveOrganizationInferenceResult {
  const db = getDb();
  const conditions = [
    "r.review_status IN ('unreviewed', 'in_review')",
    "(r.owner IS NULL OR r.owner = '' OR r.target_path IS NULL OR r.target_path = '')",
  ];
  const params: unknown[] = [];
  if (opts.root_type) {
    conditions.push("r.root_type = ?");
    params.push(opts.root_type);
  }

  const limitClause = opts.limit && opts.limit > 0 ? "LIMIT ?" : "";
  if (limitClause) params.push(opts.limit);
  const rows = (db.query(
    `SELECT r.*, f.name as file_name
     FROM file_organization_reviews r
     JOIN files f ON f.id = r.file_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY
       CASE r.root_type WHEN 'shared_drive' THEN 0 WHEN 'my_drive' THEN 1 ELSE 2 END,
       r.original_path ASC
     ${limitClause}`,
  ) as any).all(params) as Array<ReviewRow & { file_name: string }>;

  const byOwner = new Map<string, number>();
  const byRootType = new Map<FileOrganizationRootType, number>();
  const samples: GoogleDriveOrganizationInferenceResult["samples"] = [];
  let matched = 0;
  let updated = 0;

  for (const row of rows) {
    const candidate = inferOrganizationCandidate(row);
    if (!candidate) continue;
    matched++;
    byOwner.set(candidate.owner, (byOwner.get(candidate.owner) ?? 0) + 1);
    const rootType = row.root_type as FileOrganizationRootType;
    byRootType.set(rootType, (byRootType.get(rootType) ?? 0) + 1);
    if (samples.length < 20) {
      samples.push({
        review_id: row.id,
        file_id: row.file_id,
        root_type: rootType,
        owner: candidate.owner,
        target_path: candidate.target_path,
        original_path: row.original_path,
      });
    }

    if (!opts.apply) continue;

    const labels = [...new Set([...parseJson<string[]>(row.labels, []), ...candidate.labels])];
    updateFileOrganizationReview(row.id, {
      status: row.review_status === "unreviewed" ? "in_review" : row.review_status as FileOrganizationReviewStatus,
      owner: row.owner || candidate.owner,
      target_path: row.target_path || candidate.target_path,
      labels,
      permissions_metadata: {
        organization_inference: {
          source: "google_drive_top_level_folder",
          root_type: rootType,
          top_level: candidate.top_level,
          confidence: "candidate",
          requires_owner_approval: true,
        },
      },
      notes: row.notes ?? "Candidate owner and target path inferred from Google Drive top-level folder; ACL still needs owner/reviewer approval.",
      actor: opts.actor ?? "open-files-organize-infer",
      note: `candidate owner/target inferred from Google Drive top-level folder "${candidate.top_level}"; ACL remains needs_review pending owner approval`,
    });
    updated++;
  }

  return {
    dry_run: !opts.apply,
    scanned: rows.length,
    matched,
    updated,
    skipped: rows.length - matched,
    by_owner: [...byOwner.entries()].map(([owner, count]) => ({ owner, count })).sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner)),
    by_root_type: [...byRootType.entries()].map(([root_type, count]) => ({ root_type, count })).sort((a, b) => b.count - a.count || a.root_type.localeCompare(b.root_type)),
    samples,
  };
}

export function applyGoogleDriveUnifiedOrganizationPolicy(opts: {
  apply?: boolean;
  mark_moved?: boolean;
  limit?: number;
  actor?: string;
} = {}): GoogleDriveUnifiedOrganizationPolicyResult {
  const db = getDb();
  const limitClause = opts.limit && opts.limit > 0 ? "LIMIT ?" : "";
  const params = limitClause ? [opts.limit] : [];
  const rows = (db.query(
    `SELECT
       r.*,
       f.name as file_name,
       f.size as file_size,
       f.mime as file_mime,
       f.modified_at as file_modified_at,
       f.indexed_at as file_indexed_at
     FROM file_organization_reviews r
     JOIN files f ON f.id = r.file_id
     WHERE r.review_status != 'ignored'
     ORDER BY
       CASE r.root_type WHEN 'shared_drive' THEN 0 WHEN 'my_drive' THEN 1 ELSE 2 END,
       r.original_path ASC,
       r.id ASC
     ${limitClause}`,
  ) as any).all(params) as UnifiedDrivePolicyRow[];

  const duplicateRows = new Map<string, UnifiedDrivePolicyRow[]>();
  for (const row of rows) {
    if (!row.duplicate_group_id) continue;
    const group = duplicateRows.get(row.duplicate_group_id) ?? [];
    group.push(row);
    duplicateRows.set(row.duplicate_group_id, group);
  }

  const duplicateSurvivors = new Map<string, string>();
  for (const [groupId, groupRows] of duplicateRows.entries()) {
    duplicateSurvivors.set(groupId, chooseLatestDuplicateSurvivor(groupRows).id);
  }

  let skipped = 0;
  const plan: UnifiedDrivePlanItem[] = [];
  for (const row of rows) {
    const candidate = inferUnifiedDriveCandidate(row);
    if (!candidate) {
      skipped++;
      continue;
    }
    const isDuplicateSurvivor = !row.duplicate_group_id || duplicateSurvivors.get(row.duplicate_group_id) === row.id;
    plan.push({
      row,
      candidate,
      status: isDuplicateSurvivor ? (opts.mark_moved ? "moved" : "approved") : "duplicate",
      is_duplicate_survivor: isDuplicateSurvivor,
    });
  }

  const activeTargetCounts = new Map<string, number>();
  for (const item of plan) {
    if (item.status === "duplicate") continue;
    activeTargetCounts.set(item.candidate.target_path, (activeTargetCounts.get(item.candidate.target_path) ?? 0) + 1);
  }

  let targetCollisions = 0;
  for (const item of plan) {
    if (item.status === "duplicate") continue;
    if ((activeTargetCounts.get(item.candidate.target_path) ?? 0) <= 1) continue;
    item.candidate.target_path = addTargetPathDisambiguator(item.candidate.target_path, item.row.file_id);
    targetCollisions++;
  }

  let plannedUpdates = 0;
  let metadataMoves = 0;
  let permissionApprovals = 0;
  const byOwner = new Map<string, number>();
  const byRootType = new Map<FileOrganizationRootType, number>();

  for (const item of plan) {
    const row = item.row;
    const candidate = item.candidate;
    const labels = unifiedDriveLabels(row, candidate);
    const owner = item.status === "duplicate" ? (row.owner || candidate.owner) : candidate.owner;
    const targetPath = item.status === "duplicate"
      ? (row.target_path || candidate.target_path)
      : candidate.target_path;
    const permissionMetadata = unifiedDrivePermissionsMetadata(row, item);
    const permissionNotes = "Broad additive access approved for the unified Google Drive migration policy; source permissions remain preserved as audit metadata until final legacy retirement.";

    byOwner.set(owner, (byOwner.get(owner) ?? 0) + 1);
    const rootType = row.root_type as FileOrganizationRootType;
    byRootType.set(rootType, (byRootType.get(rootType) ?? 0) + 1);

    const existingLabels = parseJson<string[]>(row.labels, []);
    const needsUpdate = row.review_status !== item.status
      || row.owner !== owner
      || row.target_path !== targetPath
      || row.acl_review_status !== "approved"
      || row.permission_scope !== "domain"
      || row.permission_risk !== "low"
      || !labels.every((label) => existingLabels.includes(label));
    if (!needsUpdate) continue;

    plannedUpdates++;
    if (row.target_path !== targetPath || item.status === "moved") metadataMoves++;
    if (row.acl_review_status !== "approved" || row.permission_scope !== "domain" || row.permission_risk !== "low") {
      permissionApprovals++;
    }

    if (!opts.apply) continue;

    updateFileOrganizationReview(row.id, {
      status: item.status,
      owner,
      acl_review_status: "approved",
      permission_scope: "domain",
      permission_risk: "low",
      permission_notes: permissionNotes,
      permissions_metadata: permissionMetadata,
      target_path: targetPath,
      labels,
      reviewer: opts.actor ?? "open-files-unified-drive-policy",
      actor: opts.actor ?? "open-files-unified-drive-policy",
      note: item.status === "duplicate"
        ? "Unified Drive policy marked duplicate row; canonical bytes remain immutable and legacy backup is retained."
        : "Unified Drive policy assigned owner, normalized target path, and broad additive permission metadata without rewriting S3 objects.",
    });
  }

  return {
    dry_run: !opts.apply,
    scanned: rows.length,
    planned_updates: plannedUpdates,
    metadata_moves: metadataMoves,
    duplicate_groups: duplicateRows.size,
    duplicate_survivors: duplicateSurvivors.size,
    duplicate_rows: plan.filter((item) => item.status === "duplicate").length,
    permission_approvals: permissionApprovals,
    target_collisions: targetCollisions,
    skipped,
    by_owner: sortedCount(byOwner, "owner"),
    by_root_type: sortedCount(byRootType, "root_type"),
  };
}

export function getFileOrganizationReview(idOrFileId: string): FileOrganizationReview | null {
  const row = getDb().query<ReviewRow, [string, string]>(
    "SELECT * FROM file_organization_reviews WHERE id = ? OR file_id = ? LIMIT 1",
  ).get(idOrFileId, idOrFileId);
  return row ? toReview(row) : null;
}

export function listFileOrganizationDuplicateGroups(opts: {
  owner?: string;
  unassigned?: boolean;
  root_type?: FileOrganizationRootType;
  include_rows?: boolean;
  limit?: number;
  offset?: number;
} = {}): FileOrganizationDuplicateGroupSummary[] {
  if (opts.owner && opts.unassigned) {
    throw new Error("Duplicate group filters cannot combine owner and unassigned");
  }
  const db = getDb();
  const conditions = ["r.duplicate_group_id IS NOT NULL"];
  const params: unknown[] = [];
  if (opts.owner) {
    conditions.push("r.owner = ?");
    params.push(opts.owner);
  }
  if (opts.unassigned) {
    conditions.push("(r.owner IS NULL OR r.owner = '')");
  }
  if (opts.root_type) {
    conditions.push("r.root_type = ?");
    params.push(opts.root_type);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const groups = (db.query(
    `SELECT r.duplicate_group_id as duplicate_group_id, COUNT(*) as row_count
     FROM file_organization_reviews r
     ${where}
     GROUP BY r.duplicate_group_id
     ORDER BY row_count DESC, r.duplicate_group_id ASC
     LIMIT ? OFFSET ?`,
  ) as any).all([...params, opts.limit ?? 50, opts.offset ?? 0]) as Array<{ duplicate_group_id: string; row_count: number }>;

  const result: FileOrganizationDuplicateGroupSummary[] = [];
  for (const group of groups) {
    const rows = db.query<DuplicateReviewRow, [string]>(
      `SELECT r.*, f.name as file_name, f.size as file_size, f.mime as file_mime
       FROM file_organization_reviews r
       JOIN files f ON f.id = r.file_id
       WHERE r.duplicate_group_id = ?
       ORDER BY
         CASE r.review_status WHEN 'moved' THEN 0 WHEN 'approved' THEN 1 WHEN 'in_review' THEN 2 ELSE 3 END,
         CASE WHEN r.owner IS NULL OR r.owner = '' THEN 1 ELSE 0 END,
         CASE WHEN r.target_path IS NULL OR r.target_path = '' THEN 1 ELSE 0 END,
         r.root_type ASC,
         r.original_path ASC,
         r.id ASC`,
    ).all(group.duplicate_group_id);
    if (rows.length === 0) continue;
    result.push(summarizeDuplicateGroup(group.duplicate_group_id, rows, Boolean(opts.include_rows)));
  }

  return result;
}

export function listFileOrganizationUnassignedGroups(opts: {
  root_type?: FileOrganizationRootType;
  top_level?: string;
  exclude_top_levels?: string[];
  include_rows?: boolean;
  limit?: number;
  offset?: number;
} = {}): FileOrganizationUnassignedGroupSummary[] {
  if (opts.top_level && opts.exclude_top_levels?.length) {
    throw new Error("Unassigned group filters cannot combine top_level and exclude_top_levels");
  }
  const db = getDb();
  const conditions = [
    "(r.owner IS NULL OR r.owner = '' OR r.target_path IS NULL OR r.target_path = '')",
  ];
  const params: unknown[] = [];
  if (opts.root_type) {
    conditions.push("r.root_type = ?");
    params.push(opts.root_type);
  }

  const rows = (db.query(
    `SELECT r.*, f.name as file_name, f.size as file_size, f.mime as file_mime
     FROM file_organization_reviews r
     JOIN files f ON f.id = r.file_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY r.root_type ASC, r.original_path ASC, r.id ASC`,
  ) as any).all(params) as UnassignedReviewRow[];

  const groups = new Map<string, UnassignedReviewRow[]>();
  for (const row of rows) {
    const rest = stripGoogleDriveReviewPrefix(row);
    const topLevel = firstPathSegment(rest) || "_root";
    const key = `${row.root_type}\0${topLevel}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  let summaries = [...groups.entries()]
    .map(([key, groupRows]) => {
      const [rootType, topLevel] = key.split("\0") as [FileOrganizationRootType, string];
      return summarizeUnassignedGroup(rootType, topLevel, groupRows, Boolean(opts.include_rows));
    });

  if (opts.top_level) {
    summaries = summaries.filter((group) => group.top_level === opts.top_level);
  }
  if (opts.exclude_top_levels?.length) {
    const excluded = new Set(opts.exclude_top_levels);
    summaries = summaries.filter((group) => !excluded.has(group.top_level));
  }

  return summaries
    .sort((a, b) => b.row_count - a.row_count || a.root_type.localeCompare(b.root_type) || a.top_level.localeCompare(b.top_level))
    .slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 50));
}

export function buildFileOrganizationApprovalPacket(opts: {
  root_type?: FileOrganizationRootType;
  owner?: string;
  acl_review_status?: FileOrganizationAclReviewStatus;
  sample_limit?: number;
  duplicate_limit?: number;
} = {}): FileOrganizationApprovalPacket {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.root_type) {
    conditions.push("r.root_type = ?");
    params.push(opts.root_type);
  }
  if (opts.owner) {
    conditions.push("r.owner = ?");
    params.push(opts.owner);
  }
  if (opts.acl_review_status) {
    conditions.push("r.acl_review_status = ?");
    params.push(normalizeAclReviewStatus(opts.acl_review_status));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = (db.query(
    `SELECT r.*, f.name as file_name, f.size as file_size, f.mime as file_mime
     FROM file_organization_reviews r
     JOIN files f ON f.id = r.file_id
     ${where}
     ORDER BY
       CASE WHEN r.duplicate_group_id IS NOT NULL THEN 0 ELSE 1 END,
       CASE r.permission_risk WHEN 'high' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END,
       r.original_path ASC,
       r.id ASC`,
  ) as any).all(params) as ApprovalPacketReviewRow[];

  const byMime = new Map<string, { count: number; size: number }>();
  const byTopLevel = new Map<string, { count: number; size: number }>();
  const byReviewStatus = new Map<FileOrganizationReviewStatus, number>();
  const byPermissionScope = new Map<FileOrganizationPermissionScope, number>();
  const byPermissionRisk = new Map<FileOrganizationPermissionRisk, number>();
  const byAclStatus = new Map<FileOrganizationAclReviewStatus, number>();
  let totalSize = 0;
  let duplicateRowCount = 0;
  let unassignedCount = 0;
  let missingTargetCount = 0;

  for (const row of rows) {
    totalSize += row.file_size;
    if (row.duplicate_group_id) duplicateRowCount++;
    if (!row.owner) unassignedCount++;
    if (!row.target_path && !row.target_collection_id && !row.target_project_id) missingTargetCount++;

    incrementCount(byReviewStatus, row.review_status as FileOrganizationReviewStatus);
    incrementCount(byPermissionScope, row.permission_scope as FileOrganizationPermissionScope);
    incrementCount(byPermissionRisk, row.permission_risk as FileOrganizationPermissionRisk);
    incrementCount(byAclStatus, row.acl_review_status as FileOrganizationAclReviewStatus);
    incrementCountAndSize(byMime, row.file_mime, row.file_size);
    incrementCountAndSize(byTopLevel, firstPathSegment(stripGoogleDriveReviewPrefix(row)) || "_root", row.file_size);
  }

  const sampleLimit = opts.sample_limit ?? 25;
  const duplicateLimit = opts.duplicate_limit ?? 10;
  const listArgs = [
    opts.root_type ? `--root-type ${opts.root_type}` : undefined,
    opts.owner ? `--owner ${opts.owner}` : undefined,
    opts.acl_review_status ? `--acl-status ${opts.acl_review_status}` : undefined,
  ].filter(Boolean).join(" ");
  const duplicateArgs = [
    opts.root_type ? `--root-type ${opts.root_type}` : undefined,
    opts.owner ? `--owner ${opts.owner}` : undefined,
  ].filter(Boolean).join(" ");

  return {
    generated_at: new Date().toISOString(),
    filters: {
      root_type: opts.root_type,
      owner: opts.owner,
      acl_review_status: opts.acl_review_status ? normalizeAclReviewStatus(opts.acl_review_status) : undefined,
    },
    summary: {
      row_count: rows.length,
      total_size: totalSize,
      duplicate_row_count: duplicateRowCount,
      unassigned_count: unassignedCount,
      missing_target_count: missingTargetCount,
      by_mime: sortedCountSize(byMime, "mime"),
      by_top_level: sortedCountSize(byTopLevel, "top_level"),
      by_review_status: sortedCount(byReviewStatus, "review_status"),
      by_permission_scope: sortedCount(byPermissionScope, "permission_scope"),
      by_permission_risk: sortedCount(byPermissionRisk, "permission_risk"),
      by_acl_status: sortedCount(byAclStatus, "acl_review_status"),
    },
    duplicate_groups: listFileOrganizationDuplicateGroups({
      root_type: opts.root_type,
      owner: opts.owner,
      limit: duplicateLimit,
    }),
    samples: rows.slice(0, sampleLimit).map(toApprovalPacketRow),
    commands: {
      sample_rows: `files organize list ${listArgs} --limit ${sampleLimit} --json`.replace(/\s+/g, " ").trim(),
      duplicate_groups: `files organize duplicates ${duplicateArgs} --limit ${duplicateLimit} --json`.replace(/\s+/g, " ").trim(),
      full_audit_export: "files organize export --include-events --limit 0 --output <approval-audit.json>",
      post_approval_update: "files organize review <review_id> --acl-status <approved|restricted|external_review> --permission-scope <scope> --permission-risk <low|medium|high> --permission-notes <approval evidence> --reviewer <owner/reviewer>",
    },
    guardrails: [
      "This packet is read-only and does not change file organization rows.",
      "Do not change acl_review_status, permission_scope, or permission_risk without owner/reviewer approval evidence.",
      "Do not mark rows moved or duplicate from this packet alone.",
      "Do not rewrite canonical S3 object keys as part of ACL approval.",
      "After approved updates, push file_organization_reviews and file_organization_events to canonical Postgres and export evidence.",
    ],
  };
}

export function updateFileOrganizationReview(idOrFileId: string, updates: {
  status?: FileOrganizationReviewStatus;
  owner?: string | null;
  acl_review_status?: FileOrganizationAclReviewStatus;
  permission_scope?: FileOrganizationPermissionScope;
  permission_risk?: FileOrganizationPermissionRisk;
  permission_notes?: string | null;
  permissions_metadata?: Record<string, unknown>;
  labels?: string[];
  target_path?: string | null;
  target_collection_id?: string | null;
  target_project_id?: string | null;
  duplicate_group_id?: string | null;
  reviewer?: string | null;
  notes?: string | null;
  actor?: string;
  note?: string;
}): FileOrganizationReview {
  const db = getDb();
  const existingRow = db.query<ReviewRow, [string, string]>(
    "SELECT * FROM file_organization_reviews WHERE id = ? OR file_id = ? LIMIT 1",
  ).get(idOrFileId, idOrFileId);
  if (!existingRow) throw new Error(`Organization review not found: ${idOrFileId}`);

  const before = toReview(existingRow);
  const nextStatus = updates.status ? normalizeStatus(updates.status) : before.review_status;
  const nextAclStatus = updates.acl_review_status ? normalizeAclReviewStatus(updates.acl_review_status) : before.acl_review_status;
  const nextPermissionScope = updates.permission_scope ? normalizePermissionScope(updates.permission_scope) : before.permission_scope;
  const nextPermissionRisk = updates.permission_risk ? normalizePermissionRisk(updates.permission_risk) : before.permission_risk;
  const reviewedAt = nextStatus === "unreviewed" ? null : new Date().toISOString();
  const labels = updates.labels !== undefined ? JSON.stringify([...new Set(updates.labels.map((label) => label.trim()).filter(Boolean))]) : existingRow.labels;
  const permissionsMetadata = updates.permissions_metadata !== undefined
    ? JSON.stringify({ ...before.permissions_metadata, ...updates.permissions_metadata })
    : existingRow.permissions_metadata;
  const aclChanged = updates.acl_review_status !== undefined
    || updates.permission_scope !== undefined
    || updates.permission_risk !== undefined
    || updates.permission_notes !== undefined
    || updates.permissions_metadata !== undefined;

  db.transaction(() => {
    db.run(
      `UPDATE file_organization_reviews
       SET review_status = ?,
           owner = ?,
           acl_review_status = ?,
           permission_scope = ?,
           permission_risk = ?,
           permission_notes = ?,
           permissions_metadata = ?,
           labels = ?,
           target_path = ?,
           target_collection_id = ?,
           target_project_id = ?,
           duplicate_group_id = ?,
           reviewer = ?,
           reviewed_at = ?,
           notes = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [
        nextStatus,
        updates.owner !== undefined ? updates.owner : existingRow.owner,
        nextAclStatus,
        nextPermissionScope,
        nextPermissionRisk,
        updates.permission_notes !== undefined ? updates.permission_notes : existingRow.permission_notes,
        permissionsMetadata,
        labels,
        updates.target_path !== undefined ? updates.target_path : existingRow.target_path,
        updates.target_collection_id !== undefined ? updates.target_collection_id : existingRow.target_collection_id,
        updates.target_project_id !== undefined ? updates.target_project_id : existingRow.target_project_id,
        updates.duplicate_group_id !== undefined ? updates.duplicate_group_id : existingRow.duplicate_group_id,
        updates.reviewer !== undefined ? updates.reviewer : existingRow.reviewer,
        reviewedAt,
        updates.notes !== undefined ? updates.notes : existingRow.notes,
        existingRow.id,
      ],
    );

    if (updates.target_collection_id) {
      db.run(
        "INSERT OR IGNORE INTO collection_files (collection_id, file_id) VALUES (?, ?)",
        [updates.target_collection_id, existingRow.file_id],
      );
    }
    if (updates.target_project_id) {
      db.run(
        "INSERT OR IGNORE INTO project_files (project_id, file_id) VALUES (?, ?)",
        [updates.target_project_id, existingRow.file_id],
      );
    }

    const after = getFileOrganizationReview(existingRow.id)!;
    insertOrganizationEvent({
      review_id: existingRow.id,
      file_id: existingRow.file_id,
      action: nextStatus === "moved" ? "move_metadata" : aclChanged ? "update_acl_review" : "update_review",
      actor: updates.actor,
      from_status: before.review_status,
      to_status: after.review_status,
      before_state: { ...before },
      after_state: { ...after },
      note: updates.note,
    });
  });

  const after = getFileOrganizationReview(existingRow.id)!;
  refreshFileFts(existingRow.file_id);
  if (aclChanged) {
    emitPermissionOutboxEvent(before, after, updates.actor);
    if (after.acl_review_status === "restricted" || after.permission_risk === "high") {
      emitPermissionOutboxEvent(before, after, updates.actor, "acl_revoked");
    }
  }
  return after;
}

export function listFileOrganizationEvents(reviewIdOrFileId: string, limit = 50): FileOrganizationEvent[] {
  return getDb()
    .query<EventRow, [string, string, number]>(
      `SELECT * FROM file_organization_events
       WHERE review_id = ? OR file_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(reviewIdOrFileId, reviewIdOrFileId, limit)
    .map(toEvent);
}

export function exportFileOrganizationAudit(opts: {
  include_events?: boolean;
  limit?: number;
} = {}): FileOrganizationAuditExport {
  const limit = opts.limit ?? 1000;
  const db = getDb();
  const stats = getFileOrganizationStats();
  const by_owner = db.query<{ owner: string; count: number }, []>(
    `SELECT COALESCE(NULLIF(owner, ''), '_unassigned') as owner, COUNT(*) as count
     FROM file_organization_reviews
     GROUP BY COALESCE(NULLIF(owner, ''), '_unassigned')
     ORDER BY count DESC, owner ASC`,
  ).all();
  const by_duplicate_group = db.query<{ duplicate_group_id: string; count: number }, []>(
    `SELECT duplicate_group_id, COUNT(*) as count
     FROM file_organization_reviews
     WHERE duplicate_group_id IS NOT NULL
     GROUP BY duplicate_group_id
     ORDER BY count DESC, duplicate_group_id ASC
     LIMIT 100`,
  ).all();
  const unresolvedWhere = `r.review_status IN ('unreviewed', 'in_review')
    OR r.owner IS NULL OR r.owner = ''
    OR (r.target_path IS NULL AND r.target_collection_id IS NULL AND r.target_project_id IS NULL)
    OR r.acl_review_status IN ('needs_review', 'external_review', 'unknown')
    OR r.permission_risk IN ('high', 'unknown')`;
  const permissionRiskWhere = `r.permission_risk IN ('high', 'unknown')
    OR r.acl_review_status IN ('needs_review', 'external_review', 'unknown')`;

  const unresolved_rows = selectAuditRows(unresolvedWhere, limit);
  const moved_rows = selectAuditRows("r.review_status = 'moved'", limit);
  const ignored_rows = selectAuditRows("r.review_status = 'ignored'", limit);
  const permission_risk_rows = selectAuditRows(permissionRiskWhere, limit);
  const events = opts.include_events ? selectAuditEvents(limit) : undefined;

  return {
    generated_at: new Date().toISOString(),
    stats,
    summary: {
      by_owner,
      by_duplicate_group,
      unresolved_count: countWhere(unresolvedWhere),
      moved_count: countWhere("r.review_status = 'moved'"),
      ignored_count: countWhere("r.review_status = 'ignored'"),
      permission_risk_count: countWhere(permissionRiskWhere),
      event_count: events?.length,
    },
    unresolved_rows,
    moved_rows,
    ignored_rows,
    permission_risk_rows,
    events,
  };
}

export function formatFileOrganizationAuditExport(
  audit: FileOrganizationAuditExport,
  format: FileOrganizationAuditExportFormat,
): string {
  if (format === "json") return `${JSON.stringify(audit, null, 2)}\n`;
  if (format === "jsonl") return auditToJsonl(audit);
  return auditToCsv(audit);
}

function insertOrganizationEvent(input: Omit<FileOrganizationEvent, "id" | "created_at">): FileOrganizationEvent {
  const id = `orgevt_${nanoid(10)}`;
  getDb().run(
    `INSERT INTO file_organization_events (
      id, review_id, file_id, action, actor, from_status, to_status,
      before_state, after_state, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.review_id,
      input.file_id,
      input.action,
      input.actor ?? null,
      input.from_status ?? null,
      input.to_status ?? null,
      input.before_state ? JSON.stringify(input.before_state) : null,
      input.after_state ? JSON.stringify(input.after_state) : null,
      input.note ?? null,
    ],
  );
  return toEvent(getDb().query<EventRow, [string]>("SELECT * FROM file_organization_events WHERE id = ?").get(id)!);
}

function summarizeDuplicateGroup(
  duplicateGroupId: string,
  rows: DuplicateReviewRow[],
  includeRows: boolean,
): FileOrganizationDuplicateGroupSummary {
  const convertedRows = rows.map(toDuplicateGroupRow);
  const rootTypes = uniqueSorted(convertedRows.map((row) => row.root_type));
  const owners = uniqueSorted(convertedRows.map((row) => row.owner ?? "_unassigned"));
  const reviewStatusCounts = new Map<FileOrganizationReviewStatus, number>();
  let aclNeedsReviewCount = 0;
  let permissionRiskUnknownCount = 0;
  let unassignedCount = 0;

  for (const row of convertedRows) {
    reviewStatusCounts.set(row.review_status, (reviewStatusCounts.get(row.review_status) ?? 0) + 1);
    if (row.acl_review_status === "needs_review" || row.acl_review_status === "unknown") aclNeedsReviewCount++;
    if (row.permission_risk === "unknown") permissionRiskUnknownCount++;
    if (!row.owner) unassignedCount++;
  }

  const survivor = chooseDuplicateSurvivor(convertedRows);
  const reviewReasons: string[] = [];
  if (owners.length > 1) reviewReasons.push("multiple_owner_candidates");
  if (rootTypes.length > 1) reviewReasons.push("multiple_drive_roots");
  if (unassignedCount > 0) reviewReasons.push("contains_unassigned_rows");
  if (aclNeedsReviewCount > 0) reviewReasons.push("acl_needs_review");
  if (permissionRiskUnknownCount > 0) reviewReasons.push("permission_risk_unknown");

  return {
    duplicate_group_id: duplicateGroupId,
    row_count: convertedRows.length,
    root_types: rootTypes,
    owners,
    review_statuses: [...reviewStatusCounts.entries()]
      .map(([review_status, count]) => ({ review_status, count }))
      .sort((a, b) => a.review_status.localeCompare(b.review_status)),
    acl_needs_review_count: aclNeedsReviewCount,
    permission_risk_unknown_count: permissionRiskUnknownCount,
    unassigned_count: unassignedCount,
    candidate_survivor_review_id: survivor.review_id,
    candidate_survivor_file_id: survivor.file_id,
    candidate_survivor_owner: survivor.owner,
    candidate_survivor_target_path: survivor.target_path,
    needs_owner_review: reviewReasons.length > 0,
    review_reasons: reviewReasons,
    ...(includeRows ? { rows: convertedRows } : {}),
  };
}

function toDuplicateGroupRow(row: DuplicateReviewRow): FileOrganizationDuplicateGroupRow {
  return {
    review_id: row.id,
    file_id: row.file_id,
    root_type: row.root_type as FileOrganizationRootType,
    owner: row.owner ?? undefined,
    target_path: row.target_path ?? undefined,
    review_status: row.review_status as FileOrganizationReviewStatus,
    acl_review_status: row.acl_review_status as FileOrganizationAclReviewStatus,
    permission_risk: row.permission_risk as FileOrganizationPermissionRisk,
    original_path: row.original_path,
    file_name: row.file_name,
    file_size: row.file_size,
    file_mime: row.file_mime,
  };
}

function chooseDuplicateSurvivor(rows: FileOrganizationDuplicateGroupRow[]): FileOrganizationDuplicateGroupRow {
  return [...rows].sort((a, b) => duplicateSurvivorScore(b) - duplicateSurvivorScore(a)
    || a.root_type.localeCompare(b.root_type)
    || (a.owner ?? "").localeCompare(b.owner ?? "")
    || (a.target_path ?? a.original_path).localeCompare(b.target_path ?? b.original_path)
    || a.review_id.localeCompare(b.review_id))[0]!;
}

function duplicateSurvivorScore(row: FileOrganizationDuplicateGroupRow): number {
  const statusScore: Record<FileOrganizationReviewStatus, number> = {
    moved: 100,
    approved: 80,
    in_review: 40,
    unreviewed: 0,
    duplicate: -20,
    ignored: -30,
  };
  return statusScore[row.review_status]
    + (row.owner ? 20 : 0)
    + (row.target_path ? 20 : 0)
    + (row.root_type === "shared_drive" ? 5 : 0)
    + (row.acl_review_status === "approved" ? 10 : 0)
    + (row.permission_risk === "low" ? 5 : 0)
    - (row.permission_risk === "high" ? 20 : 0);
}

function uniqueSorted<T extends string>(values: Array<T | undefined>): T[] {
  return [...new Set(values.filter((value): value is T => Boolean(value)))].sort((a, b) => a.localeCompare(b));
}

function summarizeUnassignedGroup(
  rootType: FileOrganizationRootType,
  topLevel: string,
  rows: UnassignedReviewRow[],
  includeRows: boolean,
): FileOrganizationUnassignedGroupSummary {
  let rootFileCount = 0;
  let duplicateRowCount = 0;
  const mimeCounts = new Map<string, number>();
  for (const row of rows) {
    const rest = stripGoogleDriveReviewPrefix(row);
    if (rest === topLevel) rootFileCount++;
    if (row.duplicate_group_id) duplicateRowCount++;
    mimeCounts.set(row.file_mime, (mimeCounts.get(row.file_mime) ?? 0) + 1);
  }

  const reviewReasons: string[] = ["missing_owner_or_target"];
  if (rootFileCount > 0) reviewReasons.push("contains_root_files");
  if (duplicateRowCount > 0) reviewReasons.push("contains_duplicate_rows");
  if (topLevel === "USB and External Devices") reviewReasons.push("external_device_archive");
  if (rows.length === 1) reviewReasons.push("single_loose_item");

  return {
    root_type: rootType,
    top_level: topLevel,
    row_count: rows.length,
    root_file_count: rootFileCount,
    duplicate_row_count: duplicateRowCount,
    mime_counts: [...mimeCounts.entries()]
      .map(([mime, count]) => ({ mime, count }))
      .sort((a, b) => b.count - a.count || a.mime.localeCompare(b.mime)),
    suggested_review_track: inferUnassignedReviewTrack(topLevel, rows.length, rootFileCount),
    review_reasons: reviewReasons,
    ...(includeRows ? { rows: rows.map(toUnassignedGroupRow) } : {}),
  };
}

function toUnassignedGroupRow(row: UnassignedReviewRow): FileOrganizationUnassignedGroupRow {
  return {
    review_id: row.id,
    file_id: row.file_id,
    root_type: row.root_type as FileOrganizationRootType,
    original_path: row.original_path,
    file_name: row.file_name,
    file_size: row.file_size,
    file_mime: row.file_mime,
    duplicate_group_id: row.duplicate_group_id ?? undefined,
    review_status: row.review_status as FileOrganizationReviewStatus,
  };
}

function toApprovalPacketRow(row: ApprovalPacketReviewRow): FileOrganizationApprovalPacketRow {
  return {
    review_id: row.id,
    file_id: row.file_id,
    root_type: row.root_type as FileOrganizationRootType,
    owner: row.owner ?? undefined,
    original_path: row.original_path,
    target_path: row.target_path ?? undefined,
    file_name: row.file_name,
    file_size: row.file_size,
    file_mime: row.file_mime,
    review_status: row.review_status as FileOrganizationReviewStatus,
    acl_review_status: row.acl_review_status as FileOrganizationAclReviewStatus,
    permission_scope: row.permission_scope as FileOrganizationPermissionScope,
    permission_risk: row.permission_risk as FileOrganizationPermissionRisk,
    duplicate_group_id: row.duplicate_group_id ?? undefined,
  };
}

function incrementCount<T extends string>(map: Map<T, number>, key: T): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function incrementCountAndSize(map: Map<string, { count: number; size: number }>, key: string, size: number): void {
  const current = map.get(key) ?? { count: 0, size: 0 };
  current.count++;
  current.size += size;
  map.set(key, current);
}

function sortedCount<T extends string, K extends string>(
  map: Map<T, number>,
  key: K,
): Array<Record<K, T> & { count: number }> {
  return [...map.entries()]
    .map(([value, count]) => ({ [key]: value, count }) as Record<K, T> & { count: number })
    .sort((a, b) => b.count - a.count || String(a[key]).localeCompare(String(b[key])));
}

function sortedCountSize<K extends string>(
  map: Map<string, { count: number; size: number }>,
  key: K,
): Array<Record<K, string> & { count: number; size: number }> {
  return [...map.entries()]
    .map(([value, entry]) => ({ [key]: value, count: entry.count, size: entry.size }) as Record<K, string> & { count: number; size: number })
    .sort((a, b) => b.count - a.count || String(a[key]).localeCompare(String(b[key])));
}

function inferUnassignedReviewTrack(topLevel: string, count: number, rootFileCount: number): string {
  if (topLevel === "USB and External Devices") return "external-device-archive-owner-review";
  if (topLevel === "Hasna (3)") return "legacy-hasna-folder-owner-review";
  if (topLevel === "Archive") return "archive-owner-review";
  if (rootFileCount > 0) return "loose-root-file-owner-review";
  if (count <= 5) return "small-folder-owner-review";
  return "folder-owner-review";
}

function selectAuditRows(where: string, limit: number): FileOrganizationAuditExportRow[] {
  const limitClause = limit > 0 ? "LIMIT ?" : "";
  const params = limit > 0 ? [limit] : [];
  return (getDb().query(
    `SELECT
       r.id as review_id,
       r.file_id,
       f.name as file_name,
       f.size as file_size,
       f.mime as file_mime,
       r.profile,
       r.drive_id,
       r.root_type,
       r.original_path,
       r.current_path,
       r.target_path,
       r.owner,
       r.review_status,
       r.acl_review_status,
       r.permission_scope,
       r.permission_risk,
       r.duplicate_group_id,
       g.canonical_bucket,
       g.canonical_key,
       g.canonical_sha256,
       r.updated_at
     FROM file_organization_reviews r
     JOIN files f ON f.id = r.file_id
     LEFT JOIN google_drive_imported_objects g ON g.file_record_id = r.file_id AND g.deleted = 0
     WHERE ${where}
     ORDER BY
       CASE r.permission_risk WHEN 'high' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END,
       CASE r.acl_review_status WHEN 'needs_review' THEN 0 WHEN 'external_review' THEN 1 WHEN 'unknown' THEN 2 ELSE 3 END,
       r.updated_at DESC,
       r.original_path ASC
     ${limitClause}`,
  ) as any).all(params) .map(toAuditExportRow);
}

function selectAuditEvents(limit: number): FileOrganizationAuditExportEvent[] {
  const limitClause = limit > 0 ? "LIMIT ?" : "";
  const params = limit > 0 ? [limit] : [];
  return (getDb().query(
    `SELECT
       e.id,
       e.review_id,
       e.file_id,
       f.name as file_name,
       e.action,
       e.actor,
       e.from_status,
       e.to_status,
       e.note,
       e.created_at
     FROM file_organization_events e
     LEFT JOIN files f ON f.id = e.file_id
     ORDER BY e.created_at DESC
     ${limitClause}`,
  ) as any).all(params).map((row: AuditExportEventRow) => ({
    id: row.id,
    review_id: row.review_id,
    file_id: row.file_id,
    file_name: row.file_name ?? undefined,
    action: row.action,
    actor: row.actor ?? undefined,
    from_status: row.from_status as FileOrganizationReviewStatus | null ?? undefined,
    to_status: row.to_status as FileOrganizationReviewStatus | null ?? undefined,
    note: row.note ?? undefined,
    created_at: row.created_at,
  }));
}

function countWhere(where: string): number {
  return getDb().query<{ count: number }, []>(
    `SELECT COUNT(*) as count FROM file_organization_reviews r WHERE ${where}`,
  ).get()?.count ?? 0;
}

function toAuditExportRow(row: AuditExportRow): FileOrganizationAuditExportRow {
  return {
    review_id: row.review_id,
    file_id: row.file_id,
    file_name: row.file_name,
    file_size: row.file_size,
    file_mime: row.file_mime,
    profile: row.profile ?? undefined,
    drive_id: row.drive_id ?? undefined,
    root_type: row.root_type as FileOrganizationRootType,
    original_path: row.original_path,
    current_path: row.current_path,
    target_path: row.target_path ?? undefined,
    owner: row.owner ?? undefined,
    review_status: row.review_status as FileOrganizationReviewStatus,
    acl_review_status: row.acl_review_status as FileOrganizationAclReviewStatus,
    permission_scope: row.permission_scope as FileOrganizationPermissionScope,
    permission_risk: row.permission_risk as FileOrganizationPermissionRisk,
    duplicate_group_id: row.duplicate_group_id ?? undefined,
    canonical_bucket: row.canonical_bucket ?? undefined,
    canonical_key: row.canonical_key ?? undefined,
    canonical_sha256: row.canonical_sha256 ?? undefined,
    updated_at: row.updated_at,
  };
}

function auditToJsonl(audit: FileOrganizationAuditExport): string {
  const lines: string[] = [
    JSON.stringify({ section: "metadata", generated_at: audit.generated_at }),
    JSON.stringify({ section: "stats", data: audit.stats }),
    JSON.stringify({ section: "summary", data: audit.summary }),
  ];
  for (const [section, rows] of Object.entries({
    unresolved_rows: audit.unresolved_rows,
    moved_rows: audit.moved_rows,
    ignored_rows: audit.ignored_rows,
    permission_risk_rows: audit.permission_risk_rows,
  })) {
    for (const row of rows) lines.push(JSON.stringify({ section, ...row }));
  }
  for (const event of audit.events ?? []) lines.push(JSON.stringify({ section: "events", ...event }));
  return `${lines.join("\n")}\n`;
}

function auditToCsv(audit: FileOrganizationAuditExport): string {
  const columns = [
    "section",
    "review_id",
    "file_id",
    "file_name",
    "file_size",
    "file_mime",
    "profile",
    "drive_id",
    "root_type",
    "review_status",
    "acl_review_status",
    "permission_scope",
    "permission_risk",
    "owner",
    "duplicate_group_id",
    "original_path",
    "target_path",
    "canonical_key",
    "updated_at",
  ];
  const lines = [columns.join(",")];
  for (const [section, rows] of Object.entries({
    unresolved_rows: audit.unresolved_rows,
    moved_rows: audit.moved_rows,
    ignored_rows: audit.ignored_rows,
    permission_risk_rows: audit.permission_risk_rows,
  })) {
    for (const row of rows) {
      const record = row as unknown as Record<string, unknown>;
      lines.push(columns.map((column) => csvValue(column === "section" ? section : record[column])).join(","));
    }
  }
  return `${lines.join("\n")}\n`;
}

function csvValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  const raw = String(value);
  if (!/[",\n\r]/.test(raw)) return raw;
  return `"${raw.replaceAll('"', '""')}"`;
}

function ensureCollection(input: {
  name: string;
  description: string;
  parent_id?: string;
  metadata: Record<string, unknown>;
  onCreate?: () => void;
}): string {
  const db = getDb();
  const existing = db.query<{ id: string }, [string, string | null, string | null]>(
    `SELECT id FROM collections
     WHERE name = ? AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)
     ORDER BY created_at ASC
     LIMIT 1`,
  ).get(input.name, input.parent_id ?? null, input.parent_id ?? null);
  if (existing) return existing.id;

  const id = `col_${nanoid(10)}`;
  db.run(
    `INSERT INTO collections (id, name, description, parent_id, auto_rules, metadata)
     VALUES (?, ?, ?, ?, '{}', ?)`,
    [id, input.name, input.description, input.parent_id ?? null, JSON.stringify(input.metadata)],
  );
  input.onCreate?.();
  return id;
}

function cachedCollection(cache: Map<string, string>, key: string, create: () => string): string {
  const existing = cache.get(key);
  if (existing) return existing;
  const id = create();
  cache.set(key, id);
  return id;
}

function inferProfile(rawKey: string | null): string | undefined {
  const match = rawKey?.match(/^google-drive\/([^/]+)/);
  return match?.[1];
}

function inferRootType(row: Pick<DriveImportRow, "path" | "raw_key" | "profile">): FileOrganizationRootType {
  const value = `${row.raw_key ?? ""}\n${row.path}`.toLowerCase();
  if (value.includes("/shared-drives/") || value.startsWith("shared drives/")) return "shared_drive";
  if (value.includes("/my-drive/") || value.startsWith("my drive/")) return "my_drive";
  const profile = (row.profile || inferProfile(row.raw_key) || "").toLowerCase();
  if (profile) {
    const profilePrefix = `${profile}/`;
    const rawProfilePrefix = `/raw/${profile}/`;
    if (row.path.toLowerCase().startsWith(profilePrefix) || (row.raw_key ?? "").toLowerCase().includes(rawProfilePrefix)) {
      return "shared_drive";
    }
  }
  return "unknown";
}

function inferAclDefaults(rootType: FileOrganizationRootType): {
  permission_scope: FileOrganizationPermissionScope;
  permission_risk: FileOrganizationPermissionRisk;
} {
  if (rootType === "shared_drive") return { permission_scope: "shared_drive", permission_risk: "unknown" };
  if (rootType === "my_drive") return { permission_scope: "private", permission_risk: "unknown" };
  return { permission_scope: "unknown", permission_risk: "unknown" };
}

function emitPermissionOutboxEvent(
  before: FileOrganizationReview,
  after: FileOrganizationReview,
  actor: string | undefined,
  eventType: "permission_changed" | "acl_revoked" = "permission_changed",
): void {
  const version = getLatestFileVersion(after.file_id);
  appendKnowledgeSourceOutboxEvent({
    event_type: eventType,
    source_ref: version?.source_ref ?? buildOpenFilesFileRef(after.file_id),
    file_id: after.file_id,
    source_id: after.source_id,
    revision_id: version?.id,
    status: after.review_status,
    path: after.current_path,
    idempotency_key: [
      eventType,
      after.id,
      version?.id ?? "",
      after.updated_at,
      after.acl_review_status,
      after.permission_scope,
      after.permission_risk,
    ].join(":"),
    metadata: {
      review_id: after.id,
      actor,
      before: {
        acl_review_status: before.acl_review_status,
        permission_scope: before.permission_scope,
        permission_risk: before.permission_risk,
      },
      after: {
        acl_review_status: after.acl_review_status,
        permission_scope: after.permission_scope,
        permission_risk: after.permission_risk,
      },
    },
  });
}

function inferUnifiedDriveCandidate(row: Pick<ReviewRow, "root_type" | "original_path" | "profile"> & { file_name: string }): UnifiedDriveCandidate {
  const rest = stripGoogleDriveReviewPrefix(row) || row.file_name;
  const topLevel = firstPathSegment(rest);
  const remainder = pathAfterFirstSegment(rest);
  const policy = UNIFIED_DRIVE_TOP_LEVEL_POLICY[topLevel];

  if (policy) {
    return {
      owner: policy.owner,
      target_path: normalizeOrganizationTargetPath(joinPath(policy.target_root, remainder || row.file_name)),
      labels: policy.labels,
      top_level: topLevel,
      policy_track: policy.policy_track,
    };
  }

  return {
    owner: "intake",
    target_path: normalizeOrganizationTargetPath(joinPath("intake/unassigned", rest)),
    labels: ["intake", "unassigned"],
    top_level: topLevel || "_root",
    policy_track: "intake-unassigned",
  };
}

function unifiedDriveLabels(row: ReviewRow, candidate: UnifiedDriveCandidate): string[] {
  return [...new Set([
    ...parseJson<string[]>(row.labels, []),
    "google-drive",
    "unified-drive-policy",
    row.root_type === "my_drive" ? "source-my-drive" : row.root_type === "shared_drive" ? "source-shared-drive" : "source-unknown-drive",
    candidate.owner,
    ...candidate.labels,
  ])];
}

function unifiedDrivePermissionsMetadata(row: UnifiedDrivePolicyRow, item: UnifiedDrivePlanItem): Record<string, unknown> {
  const duplicateOf = item.row.duplicate_group_id && !item.is_duplicate_survivor
    ? item.row.duplicate_group_id
    : undefined;
  return {
    unified_drive_policy: {
      version: "2026-06-15",
      action: item.status === "duplicate" ? "mark_duplicate" : "assign_owner_target_permissions",
      permission_mode: "broad_additive",
      owner: item.status === "duplicate" ? (row.owner || item.candidate.owner) : item.candidate.owner,
      allowed_profiles: ["admin", item.candidate.owner],
      source_root_type: row.root_type,
      top_level: item.candidate.top_level,
      policy_track: item.candidate.policy_track,
      duplicate_group_id: row.duplicate_group_id ?? undefined,
      duplicate_survivor: item.is_duplicate_survivor,
      duplicate_of: duplicateOf,
      duplicate_survivor_rule: "latest_modified_at_then_latest_indexed_at",
      storage_action: "metadata_only_no_s3_rewrite",
      legacy_backup_retention: "keep_until_final_audit_and_retirement_gate",
    },
  };
}

function chooseLatestDuplicateSurvivor(rows: UnifiedDrivePolicyRow[]): UnifiedDrivePolicyRow {
  return [...rows].sort((a, b) => timestampScore(b) - timestampScore(a)
    || duplicateStatusTieBreaker(b) - duplicateStatusTieBreaker(a)
    || a.root_type.localeCompare(b.root_type)
    || a.id.localeCompare(b.id))[0]!;
}

function timestampScore(row: UnifiedDrivePolicyRow): number {
  const value = row.file_modified_at || row.file_indexed_at || row.updated_at || row.created_at;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function duplicateStatusTieBreaker(row: UnifiedDrivePolicyRow): number {
  const statusScore: Record<FileOrganizationReviewStatus, number> = {
    moved: 100,
    approved: 80,
    in_review: 40,
    unreviewed: 0,
    duplicate: -20,
    ignored: -30,
  };
  return statusScore[row.review_status as FileOrganizationReviewStatus] ?? 0;
}

function normalizeOrganizationTargetPath(path: string): string {
  const rawSegments = path.replaceAll("\\", "/").split("/").map((segment) => segment.trim()).filter(Boolean);
  const segments = rawSegments.map((segment, index) => normalizeOrganizationPathSegment(segment, index === rawSegments.length - 1));
  return segments.filter(Boolean).join("/") || "intake/unassigned/unnamed";
}

function normalizeOrganizationPathSegment(segment: string, finalSegment: boolean): string {
  const extMatch = finalSegment ? segment.match(/^(.*?)(\.[A-Za-z0-9]{1,12})$/) : null;
  const rawBase = (extMatch?.[1] || segment).trim();
  const ext = extMatch?.[2]?.toLowerCase() ?? "";
  const normalized = rawBase
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/@/g, " at ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 120);
  return `${normalized || "unnamed"}${ext}`;
}

function pathAfterFirstSegment(path: string): string {
  const index = path.indexOf("/");
  return index === -1 ? "" : path.slice(index + 1);
}

function joinPath(...segments: string[]): string {
  return segments.filter(Boolean).join("/");
}

function addTargetPathDisambiguator(path: string, fileId: string): string {
  const suffix = fileId.replace(/^f_/, "").slice(0, 8).toLowerCase();
  const slashIndex = path.lastIndexOf("/");
  const dir = slashIndex === -1 ? "" : path.slice(0, slashIndex + 1);
  const name = slashIndex === -1 ? path : path.slice(slashIndex + 1);
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) return `${dir}${name}--${suffix}`;
  return `${dir}${name.slice(0, dotIndex)}--${suffix}${name.slice(dotIndex)}`;
}

function inferOrganizationCandidate(row: Pick<ReviewRow, "id" | "root_type" | "original_path" | "profile">): {
  owner: string;
  target_path: string;
  top_level: string;
  labels: string[];
} | null {
  const rest = stripGoogleDriveReviewPrefix(row);
  if (!rest) return null;
  const topLevel = firstPathSegment(rest);

  if (row.root_type === "shared_drive") {
    const owner = SHARED_DRIVE_OWNER_BY_TOP_LEVEL[topLevel];
    if (!owner) return null;
    return {
      owner,
      target_path: rest,
      top_level: topLevel,
      labels: ["google-drive", "shared-drive", owner],
    };
  }

  if (row.root_type === "my_drive") {
    const candidate = MY_DRIVE_OWNER_BY_TOP_LEVEL[topLevel];
    if (!candidate) return null;
    return {
      owner: candidate.owner,
      target_path: rest,
      top_level: topLevel,
      labels: ["google-drive", "my-drive", ...candidate.labels],
    };
  }

  return null;
}

function stripGoogleDriveReviewPrefix(row: Pick<ReviewRow, "root_type" | "original_path" | "profile">): string {
  const path = row.original_path.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  const profile = row.profile?.trim();
  if (profile) {
    const myDrivePrefix = `${profile}/my-drive/`;
    if (path.startsWith(myDrivePrefix)) return path.slice(myDrivePrefix.length);
    const profilePrefix = `${profile}/`;
    if (path.startsWith(profilePrefix)) return path.slice(profilePrefix.length);
  }
  if (path.startsWith("my-drive/")) return path.slice("my-drive/".length);
  if (path.startsWith("My Drive/")) return path.slice("My Drive/".length);
  return path;
}

function firstPathSegment(path: string): string {
  const index = path.indexOf("/");
  return (index === -1 ? path : path.slice(0, index)).trim();
}

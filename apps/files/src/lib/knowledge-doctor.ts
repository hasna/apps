import { getDb } from "../db/database.js";
import { getFile } from "../db/files.js";
import { getFileVersion, getLatestFileVersion } from "../db/file-versions.js";
import { exportKnowledgeSourceManifest } from "./knowledge-manifest.js";
import { resolveKnowledgeSourceRef } from "./knowledge-resolver.js";
import {
  actionsFor,
  addIssue,
  DOCTOR_DEFAULT_PURPOSE,
  doctorStatus,
  normalizeDoctorLimit,
  recommendationFor,
  sanitizeStorage,
  summarizeChecks,
  uniqueRefs,
} from "./knowledge-shared.js";
import { parseOpenFilesSourceRef } from "./source-ref.js";
import type {
  FileOrganizationAclReviewStatus,
  FileOrganizationPermissionRisk,
  FileOrganizationPermissionScope,
  FileOrganizationReviewStatus,
  KnowledgeSourceDoctorAclSummary,
  KnowledgeSourceDoctorCheck,
  KnowledgeSourceDoctorIssueCode,
  KnowledgeSourceDoctorOptions,
  KnowledgeSourceDoctorReport,
  KnowledgeSourceManifestFileItem,
} from "../types/index.js";


interface AclSummaryRow {
  id: string;
  owner: string | null;
  review_status: string;
  acl_review_status: string;
  permission_scope: string;
  permission_risk: string;
  updated_at: string;
}

export async function doctorKnowledgeSources(
  opts: KnowledgeSourceDoctorOptions = {},
): Promise<KnowledgeSourceDoctorReport> {
  const generatedAt = new Date().toISOString();
  const purpose = opts.purpose ?? DOCTOR_DEFAULT_PURPOSE;
  const requireExtractedText = opts.require_extracted_text ?? true;
  const checkExtractedText = opts.check_extracted_text ?? false;
  const refs = await collectDoctorSourceRefs(opts);
  const checks: KnowledgeSourceDoctorCheck[] = [];

  for (const sourceRef of refs) {
    checks.push(await doctorKnowledgeSourceRef(sourceRef, {
      ...opts,
      purpose,
      require_extracted_text: requireExtractedText,
      check_extracted_text: checkExtractedText,
    }));
  }

  return {
    generated_at: generatedAt,
    purpose,
    require_extracted_text: requireExtractedText,
    check_extracted_text: checkExtractedText,
    checked_count: checks.length,
    summary: summarizeChecks(checks),
    checks,
  };
}

async function collectDoctorSourceRefs(opts: KnowledgeSourceDoctorOptions): Promise<string[]> {
  const limit = normalizeDoctorLimit(opts.limit);
  if (opts.source_refs?.length) return uniqueRefs(opts.source_refs).slice(0, limit);

  const manifest = await exportKnowledgeSourceManifest({
    source_id: opts.source_id,
    collection_id: opts.collection_id,
    project_id: opts.project_id,
    tag: opts.tag,
    status: opts.status ?? "all",
    include_deleted: opts.include_deleted ?? true,
    include_acl_summary: true,
    limit,
  });
  return manifest.items
    .filter((item): item is KnowledgeSourceManifestFileItem => item.kind === "file")
    .map((item) => item.source_ref);
}

async function doctorKnowledgeSourceRef(
  sourceRef: string,
  opts: KnowledgeSourceDoctorOptions & {
    purpose: string;
    require_extracted_text: boolean;
    check_extracted_text: boolean;
  },
): Promise<KnowledgeSourceDoctorCheck> {
  const checkedAt = new Date().toISOString();
  const resolution = await resolveKnowledgeSourceRef(sourceRef, {
    mode: "metadata",
    purpose: opts.purpose,
    allowed_purposes: opts.allowed_purposes,
  });
  const issueCodes: KnowledgeSourceDoctorIssueCode[] = [];
  let latestRevisionId: string | undefined;
  let stale = false;

  try {
    const parsed = parseOpenFilesSourceRef(sourceRef);
    if (parsed.kind === "file") {
      const currentFile = getFile(parsed.file_id);
      latestRevisionId = getLatestFileVersion(parsed.file_id)?.id;
      const requestedVersion = parsed.revision_id ? getFileVersion(parsed.revision_id) : null;
      stale = Boolean(
        parsed.revision_id
          && currentFile
          && requestedVersion
          && (
            requestedVersion.content_hash !== currentFile.hash
            || requestedVersion.size !== currentFile.size
            || requestedVersion.mime !== currentFile.mime
            || requestedVersion.source_path !== currentFile.path
            || requestedVersion.state !== currentFile.status
          ),
      );
      if (stale) addIssue(issueCodes, "stale_revision");
      if (currentFile?.status === "deleted") addIssue(issueCodes, "deleted");
    }
  } catch {
    // The resolver already returns a machine-readable error shape for invalid refs.
  }

  if (resolution.status === "not_found") addIssue(issueCodes, "not_found");
  if (resolution.status === "denied") {
    addIssue(issueCodes, resolution.status_reason === "Source is disabled." ? "source_disabled" : "denied");
  }
  if (resolution.status === "unsupported") addIssue(issueCodes, "unsupported");
  if (resolution.status === "error") addIssue(issueCodes, "error");
  if (resolution.deleted) addIssue(issueCodes, "deleted");

  const aclSummary = resolution.file_id ? getKnowledgeSourceAclSummary(resolution.file_id) : undefined;
  if (aclSummary) {
    if (aclSummary.acl_review_status === "restricted" || aclSummary.permission_risk === "high") {
      addIssue(issueCodes, "acl_revoked");
    } else if (
      aclSummary.acl_review_status === "needs_review"
      || aclSummary.acl_review_status === "external_review"
      || aclSummary.acl_review_status === "unknown"
      || aclSummary.permission_risk === "unknown"
    ) {
      addIssue(issueCodes, "acl_review_needed");
    }
  }

  let extractionStatus = resolution.content.extraction?.status;
  if (opts.require_extracted_text && !resolution.content.text_available) {
    addIssue(issueCodes, "missing_extracted_text");
  }
  if (
    opts.check_extracted_text
    && opts.require_extracted_text
    && resolution.status === "ready"
    && !resolution.deleted
    && resolution.content.text_available
  ) {
    const extraction = await resolveKnowledgeSourceRef(sourceRef, {
      mode: "extracted_text",
      purpose: opts.purpose,
      allowed_purposes: opts.allowed_purposes,
      max_bytes: opts.max_bytes,
      max_segment_chars: opts.max_segment_chars,
    });
    extractionStatus = extraction.extracted_text?.status ?? extraction.content.extraction?.status;
    if (extraction.status !== "ready" && extraction.status !== "too_large") {
      addIssue(issueCodes, "missing_extracted_text");
    }
  }

  const status = doctorStatus(issueCodes);
  return {
    source_ref: sourceRef,
    requested_ref: resolution.requested_ref,
    resolved_ref: resolution.source_ref !== sourceRef ? resolution.source_ref : undefined,
    resolvable: resolution.status !== "not_found" && resolution.status !== "error",
    status,
    resolution_status: resolution.status,
    status_reason: resolution.status_reason,
    recommendation: recommendationFor(issueCodes),
    actions: actionsFor(issueCodes),
    issue_codes: issueCodes,
    file_id: resolution.file_id,
    revision_id: resolution.revision_id,
    latest_revision_id: latestRevisionId,
    source_id: resolution.source_id,
    path: resolution.path,
    deleted: resolution.deleted,
    stale,
    content: {
      mime: resolution.content.mime,
      size: resolution.content.size,
      hash: resolution.content.hash,
      text_available: resolution.content.text_available,
      extracted_text_ref: resolution.content.extracted_text_ref,
      extraction_status: extractionStatus,
    },
    storage: sanitizeStorage(resolution.storage),
    acl_summary: aclSummary,
    checked_at: checkedAt,
  };
}

function getKnowledgeSourceAclSummary(fileId: string): KnowledgeSourceDoctorAclSummary | undefined {
  const row = getDb().query<AclSummaryRow, [string]>(
    `SELECT id, owner, review_status, acl_review_status, permission_scope,
            permission_risk, updated_at
     FROM file_organization_reviews
     WHERE file_id = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
  ).get(fileId);
  if (!row) return undefined;
  return {
    review_id: row.id,
    owner: row.owner ?? undefined,
    review_status: row.review_status as FileOrganizationReviewStatus,
    acl_review_status: row.acl_review_status as FileOrganizationAclReviewStatus,
    permission_scope: row.permission_scope as FileOrganizationPermissionScope,
    permission_risk: row.permission_risk as FileOrganizationPermissionRisk,
    updated_at: row.updated_at,
  };
}


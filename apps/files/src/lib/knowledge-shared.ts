/**
 * Transport-independent knowledge-source helpers.
 *
 * Pure functions over the knowledge value types — no store, no `bun:sqlite`,
 * no network. The on-box resolver/doctor (`knowledge-resolver.ts`,
 * `knowledge-doctor.ts`, which read the local island behind the local opt-in)
 * and the hosted ones (`knowledge-resolver-api.ts`, which composes `/v1`
 * routes) both import them, so the two transports cannot drift on statuses,
 * recommendations or counts.
 */
import type {
  ExtractedTextResult,
  KnowledgeSourceDoctorCheck,
  KnowledgeSourceDoctorIssueCode,
  KnowledgeSourceDoctorRecommendation,
  KnowledgeSourceDoctorReport,
  KnowledgeSourceDoctorStatus,
  KnowledgeSourceResolveStatus,
  KnowledgeSourceResolverStorage,
} from "../types/index.js";

export const DOCTOR_DEFAULT_PURPOSE = "knowledge_index";
export const DOCTOR_DEFAULT_LIMIT = 100;
export const DOCTOR_MAX_LIMIT = 1000;

export function doctorStatus(issueCodes: KnowledgeSourceDoctorIssueCode[]): KnowledgeSourceDoctorStatus {
  if (!issueCodes.length) return "ready";
  if (issueCodes.includes("not_found")) return "not_found";
  if (issueCodes.includes("acl_revoked")) return "acl_revoked";
  if (issueCodes.includes("deleted")) return "deleted";
  if (issueCodes.includes("stale_revision")) return "stale";
  if (issueCodes.includes("missing_extracted_text")) return "missing_extracted_text";
  if (issueCodes.includes("source_disabled") || issueCodes.includes("denied")) return "denied";
  if (issueCodes.includes("unsupported")) return "unsupported";
  if (issueCodes.includes("error")) return "error";
  return "needs_review";
}

export function recommendationFor(issueCodes: KnowledgeSourceDoctorIssueCode[]): KnowledgeSourceDoctorRecommendation {
  if (!issueCodes.length) return "none";
  if (issueCodes.includes("not_found")) return "fix_ref";
  if (issueCodes.includes("deleted")) return "skip";
  if (issueCodes.includes("stale_revision") || issueCodes.includes("missing_extracted_text")) return "reindex";
  return "source_review";
}

export function actionsFor(issueCodes: KnowledgeSourceDoctorIssueCode[]): string[] {
  const actions = new Set<string>();
  for (const code of issueCodes) {
    if (code === "stale_revision" || code === "missing_extracted_text") actions.add("reindex");
    if (code === "not_found") {
      actions.add("fix_ref");
      actions.add("source_review");
    }
    if (code === "deleted") actions.add("drop_from_index");
    if (
      code === "acl_revoked"
      || code === "acl_review_needed"
      || code === "source_disabled"
      || code === "denied"
      || code === "unsupported"
      || code === "error"
    ) {
      actions.add("source_review");
    }
  }
  return [...actions].sort();
}

export function summarizeChecks(checks: KnowledgeSourceDoctorCheck[]): KnowledgeSourceDoctorReport["summary"] {
  const summary: KnowledgeSourceDoctorReport["summary"] = {
    ready: 0,
    needs_action: 0,
    not_found: 0,
    stale: 0,
    acl_revoked: 0,
    deleted: 0,
    missing_extracted_text: 0,
    denied: 0,
    unsupported: 0,
    error: 0,
    needs_review: 0,
  };
  for (const check of checks) {
    if (check.status === "ready") {
      summary.ready++;
      continue;
    }
    summary.needs_action++;
    summary[check.status]++;
  }
  return summary;
}

export function sanitizeStorage(storage: KnowledgeSourceResolverStorage | undefined): KnowledgeSourceResolverStorage | undefined {
  if (!storage) return undefined;
  return {
    provider: storage.provider,
    source_id: storage.source_id,
    bucket: storage.bucket,
    region: storage.region,
    version_id: storage.version_id,
    s3_object: storage.s3_object,
  };
}

export function addIssue(issueCodes: KnowledgeSourceDoctorIssueCode[], code: KnowledgeSourceDoctorIssueCode): void {
  if (!issueCodes.includes(code)) issueCodes.push(code);
}

export function uniqueRefs(refs: string[]): string[] {
  return [...new Set(refs.map((ref) => ref.trim()).filter(Boolean))];
}

export function normalizeDoctorLimit(value: number | undefined): number {
  if (!Number.isFinite(value ?? DOCTOR_DEFAULT_LIMIT)) return DOCTOR_DEFAULT_LIMIT;
  const normalized = Math.floor(value ?? DOCTOR_DEFAULT_LIMIT);
  if (normalized <= 0) return DOCTOR_DEFAULT_LIMIT;
  return Math.min(normalized, DOCTOR_MAX_LIMIT);
}

/** Map an extraction outcome onto the resolver's status vocabulary. */
export function mapExtractionStatus(extraction: ExtractedTextResult): KnowledgeSourceResolveStatus {
  if (extraction.status === "ready" || extraction.status === "empty") return "ready";
  if (extraction.status === "too_large") return "too_large";
  if (extraction.status === "unsupported") return "unsupported";
  return "error";
}

/**
 * Whether a file's bytes are extractable as text, from its mime and name alone.
 * Pure and I/O-free, so both the on-box resolver and the hosted one answer
 * `content.text_available` identically without reading the object.
 */
export function isExtractableTextMime(mime: string, filename = ""): boolean {
  const normalized = mime.split(";")[0]!.toLowerCase();
  if (normalized.startsWith("text/")) return true;
  if ([
    "application/json",
    "application/ld+json",
    "application/xml",
    "application/xhtml+xml",
    "application/yaml",
    "application/x-yaml",
    "application/toml",
    "application/javascript",
    "application/typescript",
    "application/sql",
    "image/svg+xml",
  ].includes(normalized)) return true;

  return /\.(md|markdown|mdx|txt|csv|tsv|json|jsonl|yaml|yml|toml|xml|html|htm|css|js|jsx|ts|tsx|sql|svg)$/i.test(filename);
}

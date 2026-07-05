export type SourceType = "local" | "s3" | "google_drive";
export type FileStatus = "active" | "deleted" | "moved";
export type FileAssetStatus = "pending_upload" | "uploaded" | "verified" | "archived" | "deleted";
export type FileScanStatus = "pending" | "clean" | "skipped" | "suspicious" | "blocked";
export type FileStorageProvider = "s3" | "local";
export type FileAccessAction = "create_upload" | "complete_upload" | "link" | "sign_download" | "download" | "verify" | "archive" | "delete";

export interface S3Config {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  endpoint?: string;
  profile?: string;
  forcePathStyle?: boolean;
}

export interface GoogleDriveExportFormats {
  document?: string;
  spreadsheet?: string;
  presentation?: string;
  drawing?: string;
}

export interface GoogleDriveConfig {
  profile: string;
  include_my_drive: boolean;
  include_all_shared_drives: boolean;
  shared_drive_ids?: string[];
  root_folder_ids?: string[];
  destination_source_id?: string;
  path_mode?: "id_based" | "path_based";
  delete_behavior?: "ignore" | "mark_deleted";
  export_formats?: GoogleDriveExportFormats;
}

export type SourceConfig = S3Config | GoogleDriveConfig | Record<string, never>;

export interface Machine {
  id: string;
  name: string;
  hostname: string;
  platform: string;
  arch: string;
  is_current: boolean;
  last_seen: string;
  created_at: string;
}

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  path?: string;
  bucket?: string;
  prefix?: string;
  region?: string;
  config: SourceConfig;
  machine_id: string;
  enabled: boolean;
  last_indexed_at?: string;
  file_count: number;
  created_at: string;
  updated_at: string;
}

export interface FileRecord {
  id: string;
  source_id: string;
  machine_id: string;
  path: string;
  name: string;
  original_name?: string;
  canonical_name?: string;
  ext: string;
  size: number;
  mime: string;
  description?: string;
  hash?: string;
  status: FileStatus;
  indexed_at: string;
  modified_at?: string;
  created_at: string;
}

export type FileVersionState = FileStatus;
export type FileVersionStorageProvider = "local" | "s3" | "unknown";

export interface FileVersion {
  id: string;
  file_id: string;
  source_id: string;
  source_ref: string;
  s3_object_id?: string;
  revision_identity: string;
  content_hash_algorithm: string;
  content_hash?: string;
  size: number;
  mime: string;
  storage_provider: FileVersionStorageProvider;
  bucket?: string;
  region?: string;
  object_key?: string;
  local_path?: string;
  source_path: string;
  source_modified_at?: string;
  indexed_at: string;
  state: FileVersionState;
  source_provenance: Record<string, unknown>;
  created_at: string;
}

export interface S3ObjectRecord {
  id: string;
  source_id?: string;
  identity: string;
  bucket: string;
  region?: string;
  object_key: string;
  version_id?: string;
  etag?: string;
  checksum_sha256?: string;
  size: number;
  content_type: string;
  storage_class?: string;
  server_side_encryption?: string;
  sse_kms_key_id?: string;
  metadata: Record<string, unknown>;
  org_id?: string;
  company_id?: string;
  project_id?: string;
  app?: string;
  discovered_at: string;
  created_at: string;
  updated_at: string;
}

export interface S3ObjectResolverContract {
  object_id: string;
  storage: {
    provider: "s3";
    bucket: string;
    key: string;
    region?: string;
    version_id?: string;
  };
  object: {
    size: number;
    content_type: string;
    etag?: string;
    checksum_sha256?: string;
    storage_class?: string;
    encryption?: {
      mode?: string;
      kms_key_id?: string;
    };
    metadata: Record<string, unknown>;
  };
  scope: {
    org_id?: string;
    company_id?: string;
    project_id?: string;
    app?: string;
  };
  permissions: {
    mode: "read_only";
  };
}

export type ExtractedTextStatus = "ready" | "unsupported" | "empty" | "too_large" | "error";

export interface ExtractedTextSegment {
  index: number;
  text: string;
  byte_start: number;
  byte_end: number;
  char_start: number;
  char_end: number;
  line_start: number;
  line_end: number;
  section_hint?: string;
  page_hint?: string;
}

export interface ExtractedTextResult {
  source_ref: string;
  file_id?: string;
  revision_id?: string;
  status: ExtractedTextStatus;
  status_reason?: string;
  mime: string;
  encoding?: string;
  bytes_read: number;
  total_size?: number;
  truncated: boolean;
  redacted: boolean;
  segments: ExtractedTextSegment[];
  metadata: {
    extractor: string;
    max_bytes: number;
    max_segment_chars: number;
    supported_mime: boolean;
  };
}

export interface ExtractionSnapshotPage {
  page_number: number;
  text: string;
  byte_start: number;
  byte_end: number;
  char_start: number;
  char_end: number;
  line_start: number;
  line_end: number;
  segment_indexes: number[];
}

export interface ExtractionSnapshotSection {
  id: string;
  title?: string;
  page_number: number;
  text: string;
  byte_start: number;
  byte_end: number;
  char_start: number;
  char_end: number;
  line_start: number;
  line_end: number;
  segment_indexes: number[];
}

export interface ExtractionSnapshot {
  snapshot_id: string;
  source_ref: string;
  file_id?: string;
  revision_id?: string;
  status: ExtractedTextStatus;
  status_reason?: string;
  extractor: string;
  content_hash_algorithm: "sha256";
  content_hash: string;
  mime: string;
  encoding?: string;
  language_hints: string[];
  content_hints: string[];
  redacted: boolean;
  truncated: boolean;
  bytes_read: number;
  total_size?: number;
  pages: ExtractionSnapshotPage[];
  sections: ExtractionSnapshotSection[];
  metadata: {
    generated_at: string;
    max_bytes: number;
    max_segment_chars: number;
    source_segments: number;
  };
}

export type KnowledgeSourceResolveMode = "metadata" | "content" | "extracted_text" | "snapshot" | "signed_url";
export type KnowledgeSourceResolveStatus = "ready" | "not_found" | "denied" | "unsupported" | "too_large" | "error";

export interface KnowledgeSourceResolverOptions {
  mode?: KnowledgeSourceResolveMode;
  purpose?: string;
  allowed_purposes?: string[];
  agent_id?: string;
  session_id?: string;
  max_bytes?: number;
  max_segment_chars?: number;
  allowed_mimes?: string[];
  allow_binary?: boolean;
  signed_url_expires_in?: number;
  redactor?: (text: string) => string;
  redact_patterns?: RegExp[];
}

export interface KnowledgeSourceResolverStorage {
  provider: FileVersionStorageProvider;
  source_id?: string;
  bucket?: string;
  key?: string;
  region?: string;
  version_id?: string;
  s3_object?: S3ObjectResolverContract;
}

export interface KnowledgeSourceResolution {
  source_ref: string;
  requested_ref: string;
  file_id?: string;
  revision_id?: string;
  source_id?: string;
  path?: string;
  name?: string;
  status: KnowledgeSourceResolveStatus;
  status_reason?: string;
  storage?: KnowledgeSourceResolverStorage;
  content: {
    mime: string;
    size?: number;
    hash?: string;
    text_available: boolean;
    extracted_text_ref?: string;
    bytes_read?: number;
    truncated?: boolean;
    encoding?: "utf-8" | "base64";
    text?: string;
    bytes_base64?: string;
    extraction?: {
      status: ExtractedTextStatus;
      extractor: string;
      snapshot_id?: string;
      bytes_read: number;
      truncated: boolean;
    };
  };
  extracted_text?: ExtractedTextResult;
  snapshot?: ExtractionSnapshot;
  access?: {
    kind: "signed_url";
    method: "GET";
    url: string;
    expires_at: string;
  };
  permissions: {
    mode: "read_only";
    purpose: string;
    requested_mode?: KnowledgeSourceResolveMode;
    allowed_purposes: string[];
    write: false;
  };
  updated_at?: string;
  deleted: boolean;
}

export type KnowledgeSourceDoctorIssueCode =
  | "not_found"
  | "stale_revision"
  | "acl_revoked"
  | "acl_review_needed"
  | "deleted"
  | "missing_extracted_text"
  | "source_disabled"
  | "denied"
  | "unsupported"
  | "error";

export type KnowledgeSourceDoctorStatus =
  | "ready"
  | "not_found"
  | "stale"
  | "acl_revoked"
  | "deleted"
  | "missing_extracted_text"
  | "denied"
  | "unsupported"
  | "error"
  | "needs_review";

export type KnowledgeSourceDoctorRecommendation =
  | "none"
  | "reindex"
  | "source_review"
  | "fix_ref"
  | "skip";

export interface KnowledgeSourceDoctorAclSummary {
  review_id: string;
  owner?: string;
  review_status: FileOrganizationReviewStatus;
  acl_review_status: FileOrganizationAclReviewStatus;
  permission_scope: FileOrganizationPermissionScope;
  permission_risk: FileOrganizationPermissionRisk;
  updated_at: string;
}

export interface KnowledgeSourceDoctorOptions {
  source_refs?: string[];
  source_id?: string;
  collection_id?: string;
  project_id?: string;
  tag?: string;
  status?: FileStatus | "all";
  include_deleted?: boolean;
  limit?: number;
  purpose?: string;
  allowed_purposes?: string[];
  require_extracted_text?: boolean;
  check_extracted_text?: boolean;
  max_bytes?: number;
  max_segment_chars?: number;
}

export interface KnowledgeSourceDoctorCheck {
  source_ref: string;
  requested_ref: string;
  resolved_ref?: string;
  resolvable: boolean;
  status: KnowledgeSourceDoctorStatus;
  resolution_status: KnowledgeSourceResolveStatus;
  status_reason?: string;
  recommendation: KnowledgeSourceDoctorRecommendation;
  actions: string[];
  issue_codes: KnowledgeSourceDoctorIssueCode[];
  file_id?: string;
  revision_id?: string;
  latest_revision_id?: string;
  source_id?: string;
  path?: string;
  deleted: boolean;
  stale: boolean;
  content: {
    mime: string;
    size?: number;
    hash?: string;
    text_available: boolean;
    extracted_text_ref?: string;
    extraction_status?: ExtractedTextStatus;
  };
  storage?: KnowledgeSourceResolverStorage;
  acl_summary?: KnowledgeSourceDoctorAclSummary;
  checked_at: string;
}

export interface KnowledgeSourceDoctorReport {
  generated_at: string;
  purpose: string;
  require_extracted_text: boolean;
  check_extracted_text: boolean;
  checked_count: number;
  summary: {
    ready: number;
    needs_action: number;
    not_found: number;
    stale: number;
    acl_revoked: number;
    deleted: number;
    missing_extracted_text: number;
    denied: number;
    unsupported: number;
    error: number;
    needs_review: number;
  };
  checks: KnowledgeSourceDoctorCheck[];
}

export type KnowledgeSourceManifestFormat = "json" | "jsonl";

export interface KnowledgeSourceManifestOutput {
  provider: "local" | "s3";
  path?: string;
  source_id?: string;
  key?: string;
  format?: KnowledgeSourceManifestFormat;
}

export interface KnowledgeSourceManifestArtifact {
  provider: "local" | "s3";
  format: KnowledgeSourceManifestFormat;
  bytes: number;
  path?: string;
  source_id?: string;
  bucket?: string;
  region?: string;
  key?: string;
}

export interface KnowledgeSourceManifestOptions {
  source_id?: string;
  collection_id?: string;
  tag?: string;
  project_id?: string;
  status?: FileStatus | "all";
  include_deleted?: boolean;
  delta?: boolean;
  since_cursor?: string;
  since_sync_version?: number;
  include_acl_summary?: boolean;
  after?: string;
  before?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  purpose?: string;
  format?: KnowledgeSourceManifestFormat;
  output?: KnowledgeSourceManifestOutput;
  include_evidence_assets?: boolean;
  evidence?: {
    org_id?: string;
    company_id?: string;
    app?: string;
    kind?: string;
    status?: FileAssetStatus;
    checksum?: string;
    limit?: number;
    offset?: number;
  };
}

export type KnowledgeSourceManifestExtractionStatus =
  | "available"
  | "pending"
  | ExtractedTextStatus;

export interface KnowledgeSourceManifestMachineEvidence {
  machine_id: string;
  name?: string;
  hostname?: string;
  platform?: string;
  arch?: string;
  is_current?: boolean;
}

export interface KnowledgeSourceManifestOpenFilesRootEvidence {
  open_files_root: string;
  source_id: string;
  source_type: SourceType;
  source_path: string;
  machine: KnowledgeSourceManifestMachineEvidence;
  local?: {
    path: string;
  };
  s3?: {
    bucket: string;
    prefix?: string;
    region?: string;
  };
  evidence_hash: string;
}

export interface KnowledgeSourceManifestFileItem {
  kind: "file";
  source_ref: string;
  revision_ref?: string;
  revision_id?: string;
  s3_object_id?: string;
  sync_version: number;
  source_revision_hash: string;
  file_id: string;
  source_id: string;
  source_name?: string;
  source_type?: SourceType;
  path: string;
  name: string;
  mime: string;
  size: number;
  hash?: string;
  status: FileStatus;
  updated_at: string;
  deleted: boolean;
  tombstone?: boolean;
  tags: string[];
  open_files_root: KnowledgeSourceManifestOpenFilesRootEvidence;
  storage?: KnowledgeSourceResolverStorage;
  extraction: {
    text_available: boolean;
    status: KnowledgeSourceManifestExtractionStatus;
    extracted_text_ref?: string;
    status_reason?: string;
  };
  permissions: {
    mode: "read_only";
    allowed_purposes: string[];
  };
  acl_summary?: {
    review_id: string;
    owner?: string;
    review_status: FileOrganizationReviewStatus;
    acl_review_status: FileOrganizationAclReviewStatus;
    permission_scope: FileOrganizationPermissionScope;
    permission_risk: FileOrganizationPermissionRisk;
    target_path?: string;
    target_collection_id?: string;
    target_project_id?: string;
    updated_at: string;
  };
  permission_labels: string[];
}

export interface KnowledgeSourceManifestEvidenceAssetItem {
  kind: "evidence_asset";
  source_ref: string;
  asset_ref: string;
  revision_ref: string;
  revision_id: string;
  source_revision_hash: string;
  asset_id: string;
  org_id: string;
  company_id?: string;
  app: string;
  asset_kind: string;
  classification: string;
  original_name: string;
  mime: string;
  size: number;
  hash: string;
  status: FileAssetStatus;
  scan_status: FileScanStatus;
  updated_at: string;
  storage: {
    provider: FileStorageProvider;
    bucket?: string;
    region?: string;
    key: string;
  };
  links: FileLink[];
  permissions: {
    mode: "read_only";
    allowed_purposes: string[];
    write: false;
  };
  redaction: {
    status: "metadata_only";
    metadata_only: true;
    raw_bytes_copied: false;
    raw_text_copied: false;
    private_inventory_copied: false;
    secret_values_copied: false;
  };
  permission_labels: string[];
}

export type KnowledgeSourceManifestItem =
  | KnowledgeSourceManifestFileItem
  | KnowledgeSourceManifestEvidenceAssetItem;

export interface KnowledgeSourceManifest {
  manifest_id: string;
  generated_at: string;
  format: KnowledgeSourceManifestFormat;
  filters: Record<string, unknown>;
  item_count: number;
  cursor?: string;
  next_cursor?: string;
  delta: boolean;
  high_watermark: number;
  delta_cursor: string;
  tombstone_count: number;
  items: KnowledgeSourceManifestItem[];
  artifact?: KnowledgeSourceManifestArtifact;
}

export interface FilesContextPackCitation {
  id: string;
  file_id: string;
  source_ref: string;
  attachment_ref: string;
  path: string;
  name: string;
  line_start: number;
  line_end: number;
  char_start: number;
  char_end: number;
  section_hint?: string;
}

export interface FilesContextPackExcerpt {
  citation_id: string;
  text: string;
  line_start: number;
  line_end: number;
  char_start: number;
  char_end: number;
  omitted_chars: number;
  section_hint?: string;
}

export interface FilesContextPackFile {
  file_id: string;
  source_ref: string;
  attachment_ref: string;
  revision_id?: string;
  revision_ref?: string;
  name: string;
  path: string;
  mime: string;
  size: number;
  status: FileStatus;
  hash?: string;
  modified_at?: string;
  indexed_at: string;
  search_match_sources?: SearchMatchSource[];
  search_document_kinds?: FileSearchDocumentKind[];
  extraction: {
    status: ExtractedTextStatus;
    status_reason?: string;
    bytes_read: number;
    total_size?: number;
    truncated: boolean;
    redacted: boolean;
  };
  excerpts: FilesContextPackExcerpt[];
  omitted_excerpt_count: number;
  omitted_char_count: number;
}

export interface FilesContextPackAttachmentRef {
  ref: string;
  file_id: string;
  revision_ref?: string;
  name: string;
  mime: string;
  size: number;
}

export interface FilesContextPackError {
  input: string;
  code: "not_found" | "unsupported_ref" | "extract_failed" | "invalid_ref";
  message: string;
}

export interface FilesContextPack {
  schema_version: "files.context_pack.v1";
  pack_id: string;
  mode: "context" | "search";
  query?: string;
  limits: {
    max_files: number;
    max_excerpts: number;
    max_excerpt_chars: number;
    max_total_chars: number;
    max_bytes_per_file: number;
  };
  counts: {
    requested_files: number;
    matched_files: number;
    included_files: number;
    included_excerpts: number;
    omitted_files: number;
    omitted_excerpts: number;
    omitted_chars: number;
    errors: number;
  };
  files: FilesContextPackFile[];
  citations: FilesContextPackCitation[];
  attachment_refs: FilesContextPackAttachmentRef[];
  errors: FilesContextPackError[];
  safety: {
    redacted: boolean;
    default_redactions: boolean;
    custom_redaction_patterns: number;
  };
}

export interface FilesContextPackOptions {
  file_ids?: string[];
  source_refs?: string[];
  max_files?: number;
  max_excerpts?: number;
  max_excerpt_chars?: number;
  max_total_chars?: number;
  max_bytes_per_file?: number;
  redact_patterns?: RegExp[];
}

export interface FilesSearchPackOptions extends FilesContextPackOptions {
  query: string;
  source_id?: string;
  machine_id?: string;
  tag?: string;
  ext?: string;
  search_scope?: SearchScope;
  offset?: number;
}

export type KnowledgeSourceOutboxEventType =
  | "source_created"
  | "indexed"
  | "updated"
  | "deleted"
  | "moved"
  | "hash_changed"
  | "revision_changed"
  | "extraction_ready"
  | "extraction_failed"
  | "extraction_changed"
  | "permission_changed"
  | "acl_revoked"
  | "canonical_key_changed"
  | "source_disabled"
  | "source_enabled"
  | "source_updated";

export interface KnowledgeSourceOutboxEvent {
  id: string;
  cursor: number;
  event_type: KnowledgeSourceOutboxEventType;
  source_ref?: string;
  file_id?: string;
  source_id?: string;
  revision_id?: string;
  previous_revision_id?: string;
  status?: FileStatus | string;
  hash?: string;
  size?: number;
  mime?: string;
  path?: string;
  idempotency_key?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AppendKnowledgeSourceOutboxEventInput {
  id?: string;
  event_type: KnowledgeSourceOutboxEventType;
  source_ref?: string;
  file_id?: string;
  source_id?: string;
  revision_id?: string;
  previous_revision_id?: string;
  status?: FileStatus | string;
  hash?: string;
  size?: number;
  mime?: string;
  path?: string;
  idempotency_key?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface KnowledgeSourceOutboxCheckpoint {
  consumer_id: string;
  cursor: number;
  metadata: Record<string, unknown>;
  updated_at: string;
}

export interface KnowledgeSourceOutboxWatermark {
  latest_cursor: number;
  consumer_id?: string;
  checkpoint_cursor?: number;
  lag?: number;
  updated_at?: string;
}

export interface ListKnowledgeSourceOutboxEventsOptions {
  after_cursor?: number;
  consumer_id?: string;
  event_types?: KnowledgeSourceOutboxEventType[];
  source_id?: string;
  file_id?: string;
  limit?: number;
}

export interface KnowledgeSourceOutboxPollResult {
  events: KnowledgeSourceOutboxEvent[];
  cursor: number;
  next_cursor: number;
  has_more: boolean;
  checkpoint?: KnowledgeSourceOutboxCheckpoint;
  watermark: KnowledgeSourceOutboxWatermark;
}

export interface FileAsset {
  id: string;
  org_id: string;
  company_id?: string;
  app: string;
  kind: string;
  classification: string;
  original_name: string;
  content_type: string;
  size: number;
  checksum: string;
  checksum_algorithm: string;
  storage_provider: FileStorageProvider;
  bucket?: string;
  region?: string;
  object_key: string;
  quarantine_key?: string;
  status: FileAssetStatus;
  scan_status: FileScanStatus;
  retention_until?: string;
  retention_policy?: string;
  storage_class?: string;
  legal_hold: boolean;
  immutable: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  verified_at?: string;
}

export interface FileUploadIntent {
  id: string;
  asset_id: string;
  method: "PUT";
  upload_url?: string;
  expires_at: string;
  status: "pending" | "completed" | "expired" | "cancelled";
  expected_checksum: string;
  expected_checksum_algorithm: string;
  expected_size: number;
  required_headers: Record<string, string>;
  metadata: Record<string, unknown>;
  created_at: string;
  completed_at?: string;
}

export interface FileLink {
  id: string;
  asset_id: string;
  org_id: string;
  company_id?: string;
  app: string;
  source_type: string;
  source_id: string;
  kind: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface FileAccessEvent {
  id: string;
  asset_id: string;
  org_id: string;
  company_id?: string;
  app?: string;
  actor_id?: string;
  action: FileAccessAction;
  purpose?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CreateFileAssetInput {
  id?: string;
  org_id: string;
  company_id?: string;
  app: string;
  kind: string;
  classification?: string;
  original_name: string;
  content_type: string;
  size: number;
  checksum: string;
  checksum_algorithm?: string;
  storage_provider: FileStorageProvider;
  bucket?: string;
  region?: string;
  object_key: string;
  quarantine_key?: string;
  retention_until?: string;
  retention_policy?: string;
  storage_class?: string;
  legal_hold?: boolean;
  immutable?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CreateFileLinkInput {
  asset_id: string;
  org_id: string;
  company_id?: string;
  app: string;
  source_type: string;
  source_id: string;
  kind: string;
  metadata?: Record<string, unknown>;
}

export interface CreateFileAccessEventInput {
  asset_id: string;
  org_id: string;
  company_id?: string;
  app?: string;
  actor_id?: string;
  action: FileAccessAction;
  purpose?: string;
  metadata?: Record<string, unknown>;
}

export interface FileWithTags extends FileRecord {
  tags: string[];
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface AutoRules {
  ext?: string[];
  tags?: string[];
  name_pattern?: string;
  source_id?: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  parent_id?: string;
  auto_rules?: AutoRules;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type ProjectStatus = "active" | "archived" | "completed";

export interface Project {
  id: string;
  name: string;
  description: string;
  status?: ProjectStatus;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type FileOrganizationReviewStatus =
  | "unreviewed"
  | "in_review"
  | "approved"
  | "moved"
  | "duplicate"
  | "ignored";

export type FileOrganizationRootType = "my_drive" | "shared_drive" | "unknown";
export type FileOrganizationAclReviewStatus = "needs_review" | "approved" | "restricted" | "external_review" | "unknown";
export type FileOrganizationPermissionScope = "unknown" | "private" | "domain" | "shared_drive" | "external" | "public" | "mixed";
export type FileOrganizationPermissionRisk = "unknown" | "low" | "medium" | "high";

export interface FileOrganizationReview {
  id: string;
  file_id: string;
  source_id: string;
  profile?: string;
  drive_id?: string;
  root_type: FileOrganizationRootType;
  original_path: string;
  current_path: string;
  target_path?: string;
  target_collection_id?: string;
  target_project_id?: string;
  owner?: string;
  acl_review_status: FileOrganizationAclReviewStatus;
  permission_scope: FileOrganizationPermissionScope;
  permission_risk: FileOrganizationPermissionRisk;
  permission_notes?: string;
  permissions_metadata: Record<string, unknown>;
  labels: string[];
  duplicate_group_id?: string;
  review_status: FileOrganizationReviewStatus;
  priority: string;
  reviewer?: string;
  reviewed_at?: string;
  notes?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface FileOrganizationReviewWithFile extends FileOrganizationReview {
  file_name: string;
  file_size: number;
  file_mime: string;
  canonical_bucket?: string;
  canonical_key?: string;
  canonical_sha256?: string;
}

export interface FileOrganizationEvent {
  id: string;
  review_id: string;
  file_id: string;
  action: string;
  actor?: string;
  from_status?: FileOrganizationReviewStatus;
  to_status?: FileOrganizationReviewStatus;
  before_state?: Record<string, unknown>;
  after_state?: Record<string, unknown>;
  note?: string;
  created_at: string;
}

export interface GoogleDriveOrganizationBootstrapResult {
  scanned: number;
  created: number;
  updated: number;
  duplicate_rows: number;
  collections_created: number;
  root_collection_id: string;
}

export interface GoogleDriveOrganizationInferenceResult {
  dry_run: boolean;
  scanned: number;
  matched: number;
  updated: number;
  skipped: number;
  by_owner: Array<{ owner: string; count: number }>;
  by_root_type: Array<{ root_type: FileOrganizationRootType; count: number }>;
  samples: Array<{
    review_id: string;
    file_id: string;
    root_type: FileOrganizationRootType;
    owner: string;
    target_path: string;
    original_path: string;
  }>;
}

export interface GoogleDriveUnifiedOrganizationPolicyResult {
  dry_run: boolean;
  scanned: number;
  planned_updates: number;
  metadata_moves: number;
  duplicate_groups: number;
  duplicate_survivors: number;
  duplicate_rows: number;
  permission_approvals: number;
  target_collisions: number;
  skipped: number;
  by_owner: Array<{ owner: string; count: number }>;
  by_root_type: Array<{ root_type: FileOrganizationRootType; count: number }>;
}

export interface FileOrganizationDuplicateGroupRow {
  review_id: string;
  file_id: string;
  root_type: FileOrganizationRootType;
  owner?: string;
  target_path?: string;
  review_status: FileOrganizationReviewStatus;
  acl_review_status: FileOrganizationAclReviewStatus;
  permission_risk: FileOrganizationPermissionRisk;
  original_path: string;
  file_name: string;
  file_size: number;
  file_mime: string;
}

export interface FileOrganizationDuplicateGroupSummary {
  duplicate_group_id: string;
  row_count: number;
  root_types: FileOrganizationRootType[];
  owners: string[];
  review_statuses: Array<{ review_status: FileOrganizationReviewStatus; count: number }>;
  acl_needs_review_count: number;
  permission_risk_unknown_count: number;
  unassigned_count: number;
  candidate_survivor_review_id: string;
  candidate_survivor_file_id: string;
  candidate_survivor_owner?: string;
  candidate_survivor_target_path?: string;
  needs_owner_review: boolean;
  review_reasons: string[];
  rows?: FileOrganizationDuplicateGroupRow[];
}

export interface FileOrganizationUnassignedGroupRow {
  review_id: string;
  file_id: string;
  root_type: FileOrganizationRootType;
  original_path: string;
  file_name: string;
  file_size: number;
  file_mime: string;
  duplicate_group_id?: string;
  review_status: FileOrganizationReviewStatus;
}

export interface FileOrganizationUnassignedGroupSummary {
  root_type: FileOrganizationRootType;
  top_level: string;
  row_count: number;
  root_file_count: number;
  duplicate_row_count: number;
  mime_counts: Array<{ mime: string; count: number }>;
  suggested_review_track: string;
  review_reasons: string[];
  rows?: FileOrganizationUnassignedGroupRow[];
}

export interface FileOrganizationApprovalPacketRow {
  review_id: string;
  file_id: string;
  root_type: FileOrganizationRootType;
  owner?: string;
  original_path: string;
  target_path?: string;
  file_name: string;
  file_size: number;
  file_mime: string;
  review_status: FileOrganizationReviewStatus;
  acl_review_status: FileOrganizationAclReviewStatus;
  permission_scope: FileOrganizationPermissionScope;
  permission_risk: FileOrganizationPermissionRisk;
  duplicate_group_id?: string;
}

export interface FileOrganizationApprovalPacket {
  generated_at: string;
  filters: {
    root_type?: FileOrganizationRootType;
    owner?: string;
    acl_review_status?: FileOrganizationAclReviewStatus;
  };
  summary: {
    row_count: number;
    total_size: number;
    duplicate_row_count: number;
    unassigned_count: number;
    missing_target_count: number;
    by_mime: Array<{ mime: string; count: number; size: number }>;
    by_top_level: Array<{ top_level: string; count: number; size: number }>;
    by_review_status: Array<{ review_status: FileOrganizationReviewStatus; count: number }>;
    by_permission_scope: Array<{ permission_scope: FileOrganizationPermissionScope; count: number }>;
    by_permission_risk: Array<{ permission_risk: FileOrganizationPermissionRisk; count: number }>;
    by_acl_status: Array<{ acl_review_status: FileOrganizationAclReviewStatus; count: number }>;
  };
  duplicate_groups: FileOrganizationDuplicateGroupSummary[];
  samples: FileOrganizationApprovalPacketRow[];
  commands: {
    sample_rows: string;
    duplicate_groups: string;
    full_audit_export: string;
    post_approval_update: string;
  };
  guardrails: string[];
}

export interface FileOrganizationStats {
  total: number;
  by_status: Array<{ review_status: FileOrganizationReviewStatus; count: number }>;
  by_root_type: Array<{ root_type: FileOrganizationRootType; count: number }>;
  by_acl_status: Array<{ acl_review_status: FileOrganizationAclReviewStatus; count: number }>;
  by_permission_risk: Array<{ permission_risk: FileOrganizationPermissionRisk; count: number }>;
  duplicate_rows: number;
  unassigned_owner: number;
  missing_target: number;
  acl_needs_review: number;
  high_risk_permissions: number;
}

export type FileOrganizationAuditExportFormat = "json" | "jsonl" | "csv";

export interface FileOrganizationAuditExportRow {
  review_id: string;
  file_id: string;
  file_name: string;
  file_size: number;
  file_mime: string;
  profile?: string;
  drive_id?: string;
  root_type: FileOrganizationRootType;
  original_path: string;
  current_path: string;
  target_path?: string;
  owner?: string;
  review_status: FileOrganizationReviewStatus;
  acl_review_status: FileOrganizationAclReviewStatus;
  permission_scope: FileOrganizationPermissionScope;
  permission_risk: FileOrganizationPermissionRisk;
  duplicate_group_id?: string;
  canonical_bucket?: string;
  canonical_key?: string;
  canonical_sha256?: string;
  updated_at: string;
}

export interface FileOrganizationAuditExportEvent {
  id: string;
  review_id: string;
  file_id: string;
  file_name?: string;
  action: string;
  actor?: string;
  from_status?: FileOrganizationReviewStatus;
  to_status?: FileOrganizationReviewStatus;
  note?: string;
  created_at: string;
}

export interface FileOrganizationAuditExport {
  generated_at: string;
  stats: FileOrganizationStats;
  summary: {
    by_owner: Array<{ owner: string; count: number }>;
    by_duplicate_group: Array<{ duplicate_group_id: string; count: number }>;
    unresolved_count: number;
    moved_count: number;
    ignored_count: number;
    permission_risk_count: number;
    event_count?: number;
  };
  unresolved_rows: FileOrganizationAuditExportRow[];
  moved_rows: FileOrganizationAuditExportRow[];
  ignored_rows: FileOrganizationAuditExportRow[];
  permission_risk_rows: FileOrganizationAuditExportRow[];
  events?: FileOrganizationAuditExportEvent[];
}

export interface SearchResult extends FileWithTags {
  source_name?: string;
  machine_name?: string;
  organization_owner?: string;
  organization_target_path?: string;
  organization_review_status?: FileOrganizationReviewStatus;
  search_match_sources?: SearchMatchSource[];
  search_document_kinds?: FileSearchDocumentKind[];
  search_document_count?: number;
  rank?: number;
}

export type SearchMatchSource = "metadata" | "content";
export type SearchScope = "all" | "metadata" | "content";

export type FileSearchDocumentKind =
  | "extracted_text"
  | "extraction_summary"
  | "ocr_text"
  | "vision_summary"
  | "transcript"
  | "llm_summary"
  | "semantic_metadata"
  | "manual_note";

export type FileSearchDocumentStatus = "ready" | "partial" | "unsupported" | "error" | "stale";

export interface FileSearchDocument {
  id: string;
  file_id: string;
  revision_id?: string;
  source_ref: string;
  kind: FileSearchDocumentKind;
  extractor: string;
  content_hash: string;
  searchable_text: string;
  metadata: Record<string, unknown>;
  status: FileSearchDocumentStatus;
  private: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertFileSearchDocumentInput {
  id?: string;
  file_id: string;
  revision_id?: string;
  source_ref: string;
  kind: FileSearchDocumentKind;
  extractor?: string;
  content_hash?: string;
  searchable_text: string;
  metadata?: Record<string, unknown>;
  status?: FileSearchDocumentStatus;
  private?: boolean;
  replace_existing?: boolean;
}

export interface ListFileSearchDocumentsOptions {
  file_id?: string;
  kind?: FileSearchDocumentKind;
  status?: FileSearchDocumentStatus;
  limit?: number;
  offset?: number;
}

export interface FileSearchIndexStats {
  documents: number;
  indexed_files: number;
  active_files: number;
  active_indexed_files: number;
  missing_indexed_active_files: number;
  indexed_active_coverage_pct: number;
  organized_active_files: number;
  active_files_with_owner: number;
  active_files_with_target_path: number;
  active_files_with_canonical_name: number;
  stale_documents: number;
  by_kind: Array<{ kind: FileSearchDocumentKind; count: number }>;
  by_status: Array<{ status: FileSearchDocumentStatus; count: number }>;
  by_owner: Array<{ owner: string; active_files: number; indexed_files: number }>;
  by_review_status: Array<{ review_status: FileOrganizationReviewStatus | "none"; active_files: number; indexed_files: number }>;
}

export type SyncStatus = "local_only" | "synced" | "conflict";

export interface ListFilesOptions {
  source_id?: string;
  machine_id?: string;
  tag?: string;
  collection_id?: string;
  project_id?: string;
  ext?: string;
  status?: FileStatus;
  sync_status?: SyncStatus;
  limit?: number;
  offset?: number;
  query?: string;
  after?: string;       // ISO date string, filters on modified_at or indexed_at
  before?: string;      // ISO date string
  min_size?: number;    // bytes
  max_size?: number;    // bytes
  sort?: "name" | "size" | "date";
  sort_dir?: "asc" | "desc";
  search_scope?: SearchScope;
}

export type ActionType =
  | "upload" | "download" | "tag" | "untag" | "move"
  | "delete" | "read" | "create" | "index" | "search"
  | "annotate" | "import" | "copy" | "rename" | "restore"
  | "evidence_create_upload" | "evidence_complete_upload" | "evidence_link"
  | "evidence_sign_download" | "evidence_verify";

export interface Agent {
  id: string;
  name: string;
  session_id?: string;
  project_id?: string;
  last_seen_at: string;
  created_at: string;
}

export interface AgentActivity {
  id: string;
  agent_id: string;
  action: ActionType;
  file_id?: string;
  source_id?: string;
  session_id?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface IndexStats {
  source_id: string;
  added: number;
  updated: number;
  deleted: number;
  errors: number;
  duration_ms: number;
}

export interface GoogleDriveSharedDrive {
  id: string;
  name: string;
}

export interface GoogleDriveProfileStatus {
  profile: string;
  configured: boolean;
  authenticated: boolean;
  expired: boolean;
  expiresAt: number | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  hasOAuthCredentials: boolean;
  authRequired: boolean;
  message: string;
}

export interface GoogleDriveItem {
  id: string;
  drive_id: string;
  drive_name: string;
  is_shared_drive: boolean;
  parent_id?: string;
  path: string;
  name: string;
  mime: string;
  size: number;
  modified_at?: string;
  hash?: string;
  version?: string;
  export_name?: string;
}

export interface GoogleDriveSyncState {
  source_id: string;
  last_synced_at?: string;
  last_full_scan_at?: string;
  last_error?: string;
}

export interface GoogleDriveImportedObject {
  source_id: string;
  drive_id: string;
  file_id: string;
  profile?: string;
  parent_id?: string;
  path: string;
  name: string;
  mime: string;
  size: number;
  modified_at?: string;
  version?: string;
  hash?: string;
  storage_type?: "s3" | "local";
  storage_key?: string;
  destination_source_id?: string;
  s3_key?: string;
  raw_bucket?: string;
  raw_key?: string;
  canonical_bucket?: string;
  canonical_key?: string;
  canonical_sha256?: string;
  promotion_action?: string;
  promotion_status?: string;
  file_record_id: string;
  deleted: boolean;
  last_imported_at: string;
}

export interface GoogleDrivePreflightResult {
  source_id: string;
  source_name: string;
  profile: string;
  auth: GoogleDriveProfileStatus | null;
  destination: {
    source_id: string;
    name: string;
    type: "s3" | "local";
    bucket?: string;
    prefix?: string;
    region?: string;
    aws_profile?: string;
    path?: string;
  };
  includes: {
    my_drive: boolean;
    all_shared_drives: boolean;
    shared_drive_ids: string[];
    root_folder_ids: string[];
  };
  item_count: number;
  drive_counts: Array<{
    drive_id: string;
    drive_name: string;
    is_shared_drive: boolean;
    count: number;
  }>;
  errors: string[];
}

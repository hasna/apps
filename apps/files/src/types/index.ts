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

export interface SearchResult extends FileWithTags {
  source_name?: string;
  machine_name?: string;
  rank?: number;
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

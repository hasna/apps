// Google Drive API Connector Types

// ============================================
// Configuration
// ============================================

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  scope: string;
}

export interface CliConfig {
  clientId?: string;
  clientSecret?: string;
  tokens?: OAuth2Tokens;
  userEmail?: string;
  userName?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

// ============================================
// Google Drive File Types
// ============================================

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  kind?: string;
  description?: string;
  starred?: boolean;
  trashed?: boolean;
  explicitlyTrashed?: boolean;
  parents?: string[];
  version?: string;
  webContentLink?: string;
  webViewLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  viewedByMe?: boolean;
  viewedByMeTime?: string;
  createdTime?: string;
  modifiedTime?: string;
  modifiedByMeTime?: string;
  sharedWithMeTime?: string;
  sharingUser?: User;
  owners?: User[];
  lastModifyingUser?: User;
  shared?: boolean;
  ownedByMe?: boolean;
  capabilities?: FileCapabilities;
  viewersCanCopyContent?: boolean;
  copyRequiresWriterPermission?: boolean;
  writersCanShare?: boolean;
  permissions?: Permission[];
  permissionIds?: string[];
  folderColorRgb?: string;
  originalFilename?: string;
  fullFileExtension?: string;
  fileExtension?: string;
  md5Checksum?: string;
  size?: string;
  quotaBytesUsed?: string;
  headRevisionId?: string;
  contentHints?: ContentHints;
  imageMediaMetadata?: ImageMediaMetadata;
  videoMediaMetadata?: VideoMediaMetadata;
  isAppAuthorized?: boolean;
  exportLinks?: Record<string, string>;
  shortcutDetails?: ShortcutDetails;
  contentRestrictions?: ContentRestriction[];
  resourceKey?: string;
  linkShareMetadata?: LinkShareMetadata;
}

export interface User {
  kind?: string;
  displayName?: string;
  photoLink?: string;
  me?: boolean;
  permissionId?: string;
  emailAddress?: string;
}

export interface FileCapabilities {
  canAddChildren?: boolean;
  canAddMyDriveParent?: boolean;
  canChangeCopyRequiresWriterPermission?: boolean;
  canChangeViewersCanCopyContent?: boolean;
  canComment?: boolean;
  canCopy?: boolean;
  canDelete?: boolean;
  canDeleteChildren?: boolean;
  canDownload?: boolean;
  canEdit?: boolean;
  canListChildren?: boolean;
  canModifyContent?: boolean;
  canMoveChildrenOutOfDrive?: boolean;
  canMoveChildrenWithinDrive?: boolean;
  canMoveItemIntoTeamDrive?: boolean;
  canMoveItemOutOfDrive?: boolean;
  canMoveItemWithinDrive?: boolean;
  canReadRevisions?: boolean;
  canRemoveChildren?: boolean;
  canRemoveMyDriveParent?: boolean;
  canRename?: boolean;
  canShare?: boolean;
  canTrash?: boolean;
  canTrashChildren?: boolean;
  canUntrash?: boolean;
}

export interface Permission {
  id?: string;
  type?: 'user' | 'group' | 'domain' | 'anyone';
  emailAddress?: string;
  domain?: string;
  role?: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
  allowFileDiscovery?: boolean;
  displayName?: string;
  photoLink?: string;
  expirationTime?: string;
  teamDrivePermissionDetails?: TeamDrivePermissionDetail[];
  permissionDetails?: PermissionDetail[];
  deleted?: boolean;
  pendingOwner?: boolean;
}

export interface TeamDrivePermissionDetail {
  teamDrivePermissionType?: string;
  role?: string;
  inherited?: boolean;
  inheritedFrom?: string;
}

export interface PermissionDetail {
  permissionType?: string;
  role?: string;
  inherited?: boolean;
  inheritedFrom?: string;
}

export interface ContentHints {
  thumbnail?: {
    image?: string;
    mimeType?: string;
  };
  indexableText?: string;
}

export interface ImageMediaMetadata {
  width?: number;
  height?: number;
  rotation?: number;
  location?: {
    latitude?: number;
    longitude?: number;
    altitude?: number;
  };
  time?: string;
  cameraMake?: string;
  cameraModel?: string;
  exposureTime?: number;
  aperture?: number;
  flashUsed?: boolean;
  focalLength?: number;
  isoSpeed?: number;
  meteringMode?: string;
  sensor?: string;
  exposureMode?: string;
  colorSpace?: string;
  whiteBalance?: string;
  exposureBias?: number;
  maxApertureValue?: number;
  subjectDistance?: number;
  lens?: string;
}

export interface VideoMediaMetadata {
  width?: number;
  height?: number;
  durationMillis?: string;
}

export interface ShortcutDetails {
  targetId?: string;
  targetMimeType?: string;
  targetResourceKey?: string;
}

export interface ContentRestriction {
  readOnly?: boolean;
  reason?: string;
  restrictingUser?: User;
  restrictionTime?: string;
  type?: string;
}

export interface LinkShareMetadata {
  securityUpdateEligible?: boolean;
  securityUpdateEnabled?: boolean;
}

// ============================================
// File List Response
// ============================================

export interface FileListResponse {
  kind?: string;
  nextPageToken?: string;
  incompleteSearch?: boolean;
  files: DriveFile[];
}

// ============================================
// About/Storage Types
// ============================================

export interface About {
  kind?: string;
  user?: User;
  storageQuota?: StorageQuota;
  importFormats?: Record<string, string[]>;
  exportFormats?: Record<string, string[]>;
  maxImportSizes?: Record<string, string>;
  maxUploadSize?: string;
  appInstalled?: boolean;
  folderColorPalette?: string[];
  driveThemes?: DriveTheme[];
  canCreateDrives?: boolean;
  canCreateTeamDrives?: boolean;
}

export interface StorageQuota {
  limit?: string;
  usage?: string;
  usageInDrive?: string;
  usageInDriveTrash?: string;
}

export interface DriveTheme {
  id?: string;
  backgroundImageLink?: string;
  colorRgb?: string;
}

// ============================================
// API Options
// ============================================

export interface ListFilesOptions {
  pageSize?: number;
  pageToken?: string;
  q?: string;
  orderBy?: string;
  fields?: string;
  spaces?: 'drive' | 'appDataFolder' | 'photos';
  corpora?: 'user' | 'domain' | 'drive' | 'allDrives';
  driveId?: string;
  includeItemsFromAllDrives?: boolean;
  supportsAllDrives?: boolean;
}

export interface GetFileOptions {
  fields?: string;
  supportsAllDrives?: boolean;
  acknowledgeAbuse?: boolean;
}

export interface CreateFileOptions {
  uploadType?: 'media' | 'multipart' | 'resumable';
  fields?: string;
  supportsAllDrives?: boolean;
  keepRevisionForever?: boolean;
  ocrLanguage?: string;
  useContentAsIndexableText?: boolean;
  ignoreDefaultVisibility?: boolean;
}

export interface UpdateFileOptions {
  fields?: string;
  addParents?: string;
  removeParents?: string;
  supportsAllDrives?: boolean;
  keepRevisionForever?: boolean;
  ocrLanguage?: string;
  useContentAsIndexableText?: boolean;
}

export interface CopyFileOptions {
  fields?: string;
  supportsAllDrives?: boolean;
  keepRevisionForever?: boolean;
  ocrLanguage?: string;
  ignoreDefaultVisibility?: boolean;
}

export interface CreatePermissionOptions {
  emailMessage?: string;
  sendNotificationEmail?: boolean;
  transferOwnership?: boolean;
  moveToNewOwnersRoot?: boolean;
  supportsAllDrives?: boolean;
  useDomainAdminAccess?: boolean;
}

// ============================================
// API Error Types
// ============================================

export interface DriveError {
  code: number;
  message: string;
  errors?: Array<{
    domain: string;
    reason: string;
    message: string;
    locationType?: string;
    location?: string;
  }>;
}

export class DriveApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: DriveError['errors'];

  constructor(message: string, statusCode: number, errors?: DriveError['errors']) {
    super(message);
    this.name = 'DriveApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// ============================================
// MIME Type Constants
// ============================================

export const MIME_TYPES = {
  FOLDER: 'application/vnd.google-apps.folder',
  DOCUMENT: 'application/vnd.google-apps.document',
  SPREADSHEET: 'application/vnd.google-apps.spreadsheet',
  PRESENTATION: 'application/vnd.google-apps.presentation',
  FORM: 'application/vnd.google-apps.form',
  DRAWING: 'application/vnd.google-apps.drawing',
  SCRIPT: 'application/vnd.google-apps.script',
  SITE: 'application/vnd.google-apps.site',
  SHORTCUT: 'application/vnd.google-apps.shortcut',
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  CSV: 'text/csv',
  TXT: 'text/plain',
  HTML: 'text/html',
  RTF: 'application/rtf',
  ODS: 'application/vnd.oasis.opendocument.spreadsheet',
  ODT: 'application/vnd.oasis.opendocument.text',
  ZIP: 'application/zip',
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  SVG: 'image/svg+xml',
} as const;

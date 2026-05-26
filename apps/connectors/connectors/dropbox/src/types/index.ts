// Dropbox Connector Types

// ============================================
// Configuration
// ============================================

export interface DropboxConfig {
  accessToken: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// File/Folder Metadata Types
// ============================================

export interface FileMetadata {
  '.tag': 'file';
  name: string;
  id: string;
  client_modified: string;
  server_modified: string;
  rev: string;
  size: number;
  path_lower?: string;
  path_display?: string;
  parent_shared_folder_id?: string;
  preview_url?: string;
  media_info?: {
    '.tag': 'pending' | 'metadata';
    metadata?: {
      '.tag': 'photo' | 'video';
      dimensions?: {
        height: number;
        width: number;
      };
      location?: {
        latitude: number;
        longitude: number;
      };
      time_taken?: string;
      duration?: number;
    };
  };
  symlink_info?: {
    target: string;
  };
  sharing_info?: FileSharingInfo;
  is_downloadable?: boolean;
  export_info?: {
    export_as?: string;
    export_options?: string[];
  };
  property_groups?: PropertyGroup[];
  has_explicit_shared_members?: boolean;
  content_hash?: string;
  file_lock_info?: {
    is_lockholder: boolean;
    lockholder_name?: string;
    lockholder_account_id?: string;
    created?: string;
  };
}

export interface FolderMetadata {
  '.tag': 'folder';
  name: string;
  id: string;
  path_lower?: string;
  path_display?: string;
  parent_shared_folder_id?: string;
  shared_folder_id?: string;
  sharing_info?: FolderSharingInfo;
  property_groups?: PropertyGroup[];
}

export interface DeletedMetadata {
  '.tag': 'deleted';
  name: string;
  path_lower?: string;
  path_display?: string;
  parent_shared_folder_id?: string;
}

export type Metadata = FileMetadata | FolderMetadata | DeletedMetadata;

export interface FileSharingInfo {
  read_only: boolean;
  parent_shared_folder_id?: string;
  modified_by?: string;
}

export interface FolderSharingInfo {
  read_only: boolean;
  parent_shared_folder_id?: string;
  shared_folder_id?: string;
  traverse_only: boolean;
  no_access: boolean;
}

export interface PropertyGroup {
  template_id: string;
  fields: Array<{
    name: string;
    value: string;
  }>;
}

// ============================================
// List Folder Types
// ============================================

export interface ListFolderResult {
  entries: Metadata[];
  cursor: string;
  has_more: boolean;
}

export interface ListFolderContinueResult extends ListFolderResult {}

export interface ListFolderGetLatestCursorResult {
  cursor: string;
}

// ============================================
// Search Types
// ============================================

export interface SearchMatch {
  match_type: {
    '.tag': 'filename' | 'content' | 'both';
  };
  metadata: Metadata;
  highlight_spans?: Array<{
    highlight_str: string;
    is_highlighted: boolean;
  }>;
}

export interface SearchResult {
  matches: SearchMatch[];
  more: boolean;
  start?: number;
}

export interface SearchV2Match {
  metadata: {
    '.tag': 'metadata';
    metadata: Metadata;
  };
  match_type?: {
    '.tag': 'filename' | 'file_content' | 'filename_and_content' | 'image_content';
  };
  highlight_spans?: Array<{
    highlight_str: string;
    is_highlighted: boolean;
  }>;
}

export interface SearchV2Result {
  matches: SearchV2Match[];
  has_more: boolean;
  cursor?: string;
}

// ============================================
// Sharing Types
// ============================================

export interface SharedLinkMetadata {
  '.tag': 'file' | 'folder';
  url: string;
  name: string;
  id?: string;
  path_lower?: string;
  link_permissions: {
    can_revoke: boolean;
    resolved_visibility: {
      '.tag': 'public' | 'team_only' | 'password' | 'team_and_password' | 'shared_folder_only' | 'no_one';
    };
    revoke_failure_reason?: {
      '.tag': 'owner_only' | 'team_folder';
    };
    effective_audience?: {
      '.tag': 'public' | 'team' | 'no_one' | 'password';
    };
    link_access_level?: {
      '.tag': 'viewer' | 'editor';
    };
  };
  expires?: string;
  team_member_info?: {
    team_info: {
      id: string;
      name: string;
    };
    display_name: string;
    member_id?: string;
  };
  content_owner_team_info?: {
    id: string;
    name: string;
  };
}

export interface SharedFolderMetadata {
  access_type: {
    '.tag': 'owner' | 'editor' | 'viewer' | 'viewer_no_comment' | 'traverse';
  };
  is_inside_team_folder: boolean;
  is_team_folder: boolean;
  name: string;
  policy: {
    acl_update_policy: {
      '.tag': 'owner' | 'editors';
    };
    shared_link_policy: {
      '.tag': 'anyone' | 'team' | 'members';
    };
    member_policy?: {
      '.tag': 'team' | 'anyone';
    };
    resolved_member_policy?: {
      '.tag': 'team' | 'anyone';
    };
    viewer_info_policy?: {
      '.tag': 'enabled' | 'disabled';
    };
  };
  preview_url: string;
  shared_folder_id: string;
  time_invited: string;
  owner_display_names?: string[];
  owner_team?: {
    id: string;
    name: string;
  };
  parent_shared_folder_id?: string;
  path_lower?: string;
  link_metadata?: {
    audience_options: Array<{
      '.tag': 'public' | 'team' | 'members' | 'no_one' | 'password';
    }>;
    current_audience: {
      '.tag': 'public' | 'team' | 'members' | 'no_one' | 'password';
    };
    link_permissions: Array<{
      action: {
        '.tag': string;
      };
      allow: boolean;
      reason?: {
        '.tag': string;
      };
    }>;
    password_protected: boolean;
    url: string;
  };
  permissions?: Array<{
    action: {
      '.tag': string;
    };
    allow: boolean;
    reason?: {
      '.tag': string;
    };
  }>;
  access_inheritance?: {
    '.tag': 'inherit' | 'no_inherit';
  };
}

export interface SharedFolderMember {
  user: {
    account_id: string;
    email: string;
    display_name: string;
    same_team: boolean;
    team_member_id?: string;
  };
  access_type: {
    '.tag': 'owner' | 'editor' | 'viewer' | 'viewer_no_comment';
  };
  permissions?: Array<{
    action: {
      '.tag': string;
    };
    allow: boolean;
    reason?: {
      '.tag': string;
    };
  }>;
  is_inherited: boolean;
}

export interface ListSharedLinksResult {
  links: SharedLinkMetadata[];
  has_more: boolean;
  cursor?: string;
}

export interface ListFolderMembersResult {
  users: SharedFolderMember[];
  groups?: Array<{
    group: {
      group_id: string;
      group_name: string;
      group_management_type: {
        '.tag': 'user_managed' | 'company_managed' | 'system_managed';
      };
      group_type: {
        '.tag': 'team' | 'user_managed';
      };
      is_member: boolean;
      is_owner: boolean;
      same_team: boolean;
      member_count?: number;
    };
    access_type: {
      '.tag': 'owner' | 'editor' | 'viewer' | 'viewer_no_comment';
    };
    permissions?: Array<{
      action: {
        '.tag': string;
      };
      allow: boolean;
      reason?: {
        '.tag': string;
      };
    }>;
    is_inherited: boolean;
  }>;
  invitees?: Array<{
    invitee: {
      '.tag': 'email';
      email: string;
    };
    access_type: {
      '.tag': 'owner' | 'editor' | 'viewer' | 'viewer_no_comment';
    };
    permissions?: Array<{
      action: {
        '.tag': string;
      };
      allow: boolean;
      reason?: {
        '.tag': string;
      };
    }>;
    is_inherited: boolean;
  }>;
  cursor?: string;
}

// ============================================
// User Types
// ============================================

export interface Account {
  account_id: string;
  name: {
    given_name: string;
    surname: string;
    familiar_name: string;
    display_name: string;
    abbreviated_name: string;
  };
  email: string;
  email_verified: boolean;
  disabled: boolean;
  locale: string;
  referral_link: string;
  is_paired: boolean;
  account_type: {
    '.tag': 'basic' | 'pro' | 'business';
  };
  root_info: {
    '.tag': 'user' | 'team';
    root_namespace_id: string;
    home_namespace_id?: string;
    home_path?: string;
  };
  profile_photo_url?: string;
  country?: string;
  team?: {
    id: string;
    name: string;
    sharing_policies?: {
      shared_folder_member_policy?: {
        '.tag': string;
      };
      shared_folder_join_policy?: {
        '.tag': string;
      };
      shared_link_create_policy?: {
        '.tag': string;
      };
    };
    office_addin_policy?: {
      '.tag': string;
    };
  };
  team_member_id?: string;
}

export interface SpaceUsage {
  used: number;
  allocation: {
    '.tag': 'individual' | 'team';
    allocated: number;
    team_member_used?: number;
    other_team_members_used?: number;
  };
}

// ============================================
// Copy/Move Types
// ============================================

export interface RelocationResult {
  metadata: Metadata;
}

export interface RelocationBatchResult {
  '.tag': 'complete' | 'async_job_id';
  entries?: Array<{
    metadata: Metadata;
  }>;
  async_job_id?: string;
}

export interface RelocationBatchV2Result {
  entries: Array<{
    '.tag': 'success' | 'failure';
    success?: Metadata;
    failure?: {
      '.tag': string;
    };
  }>;
}

// ============================================
// Delete Types
// ============================================

export interface DeleteResult {
  metadata: Metadata;
}

export interface DeleteBatchResult {
  '.tag': 'complete' | 'async_job_id';
  entries?: Array<{
    '.tag': 'success' | 'failure';
    success?: {
      metadata: Metadata;
    };
    failure?: {
      '.tag': string;
    };
  }>;
  async_job_id?: string;
}

// ============================================
// Upload Types
// ============================================

export interface UploadSessionStartResult {
  session_id: string;
}

export interface UploadSessionFinishResult {
  name: string;
  id: string;
  client_modified: string;
  server_modified: string;
  rev: string;
  size: number;
  path_lower?: string;
  path_display?: string;
  content_hash?: string;
}

// ============================================
// API Error Types
// ============================================

export interface DropboxErrorResponse {
  error_summary: string;
  error: {
    '.tag': string;
    [key: string]: unknown;
  };
  user_message?: {
    text: string;
    locale: string;
  };
}

export class DropboxApiError extends Error {
  public readonly statusCode: number;
  public readonly errorTag?: string;
  public readonly userMessage?: string;

  constructor(message: string, statusCode: number, errorTag?: string, userMessage?: string) {
    super(message);
    this.name = 'DropboxApiError';
    this.statusCode = statusCode;
    this.errorTag = errorTag;
    this.userMessage = userMessage;
  }
}

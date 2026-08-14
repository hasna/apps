// Stoplight Connector Types
//
// Types model the public Stoplight API (https://stoplight.io/api). Stoplight's
// API design/documentation/governance platform organizes content as
// workspaces -> projects -> nodes (OpenAPI/JSON Schema/Markdown files).

// ============================================
// Configuration
// ============================================

export interface StoplightConfig {
  /** Workspace token or personal access token. */
  token: string;
  /** Override the API base URL. Defaults to https://stoplight.io/api */
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

export interface PaginationParams {
  /** Page number (1-indexed). */
  page?: number;
  /** Page size. */
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  };
}

// ============================================
// Workspace Types
// ============================================

export interface Workspace {
  id: string;
  slug?: string;
  name?: string;
  description?: string;
  type?: string;
  visibility?: string;
  logo_url?: string;
  created_at?: string;
  updated_at?: string;
}

// ============================================
// Project Types
// ============================================

export interface Project {
  id: string;
  slug?: string;
  name?: string;
  description?: string;
  visibility?: 'public' | 'internal' | 'private' | string;
  workspace_id?: string;
  is_git?: boolean;
  git_repo_url?: string;
  default_branch?: string;
  created_at?: string;
  updated_at?: string;
}

// ============================================
// Branch Types
// ============================================

export interface Branch {
  id?: string;
  slug?: string;
  name?: string;
  is_default?: boolean;
  created_at?: string;
  updated_at?: string;
}

// ============================================
// Member & Group Types
// ============================================

export interface Member {
  id?: string;
  user_id?: string;
  email?: string;
  name?: string;
  role?: string;
  role_name?: string;
  created_at?: string;
}

export interface Group {
  id: string;
  slug?: string;
  name?: string;
  description?: string;
  member_count?: number;
  created_at?: string;
  updated_at?: string;
}

// ============================================
// Node / Table of Contents Types
// ============================================

export type NodeType =
  | 'article'
  | 'http_service'
  | 'http_operation'
  | 'model'
  | 'table_of_contents'
  | string;

export interface Node {
  id?: string;
  uri?: string;
  type?: NodeType;
  name?: string;
  title?: string;
  summary?: string;
  /** Bundled/dereferenced content of the node when requested. */
  data?: unknown;
  /** Raw file content (for markdown / non-JSON nodes). */
  content?: string;
}

export interface TableOfContentsItem {
  type?: 'group' | 'divider' | 'item' | string;
  title?: string;
  uri?: string;
  slug?: string;
  items?: TableOfContentsItem[];
}

export interface TableOfContents {
  items: TableOfContentsItem[];
}

export interface GetNodeParams {
  /** Node URI within the project (e.g. /reference/api.yaml or /docs/guide.md). */
  uri: string;
  /** Branch slug to read from (defaults to the project default branch). */
  branch?: string;
  /** Return a fully dereferenced/bundled document. */
  deref?: 'bundle' | 'optimizedBundle' | boolean;
}

// ============================================
// API Error Types
// ============================================

export interface StoplightErrorResponse {
  message?: string;
  code?: number;
  type?: string;
  /** Some routes use RFC7807-style fields. */
  title?: string;
  status?: number;
  data?: unknown;
}

export class StoplightApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: number;
  public readonly type?: string;
  public readonly data?: unknown;

  constructor(message: string, statusCode: number, code?: number, type?: string, data?: unknown) {
    super(message);
    this.name = 'StoplightApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.type = type;
    this.data = data;
  }
}

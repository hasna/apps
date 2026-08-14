// Docker Hub API Types

// ============================================
// Configuration
// ============================================

export interface DockerConfig {
  username?: string;
  password?: string;
  accessToken?: string;
  baseUrl?: string; // Override default base URL
}

// Legacy alias for compatibility
export type ConnectorConfig = DockerConfig;

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ============================================
// Repository Types
// ============================================

export interface Repository {
  user: string;
  name: string;
  namespace: string;
  repository_type: string;
  status: number;
  status_description: string;
  description: string;
  is_private: boolean;
  is_automated: boolean;
  star_count: number;
  pull_count: number;
  last_updated: string;
  date_registered: string;
  collaborator_count: number;
  affiliation: string | null;
  hub_user: string;
  has_starred: boolean;
  full_description: string;
  permissions: {
    read: boolean;
    write: boolean;
    admin: boolean;
  };
}

export interface RepositoryListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Repository[];
}

// ============================================
// Tag Types
// ============================================

export interface TagImage {
  architecture: string;
  features: string;
  variant: string | null;
  digest: string;
  os: string;
  os_features: string;
  os_version: string | null;
  size: number;
  status: string;
  last_pulled: string | null;
  last_pushed: string | null;
}

export interface Tag {
  creator: number;
  id: number;
  images: TagImage[];
  last_updated: string;
  last_updater: number;
  last_updater_username: string;
  name: string;
  repository: number;
  full_size: number;
  v2: boolean;
  tag_status: string;
  tag_last_pulled: string | null;
  tag_last_pushed: string | null;
  media_type: string;
  content_type: string;
  digest: string;
}

export interface TagListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Tag[];
}

// ============================================
// User Types
// ============================================

export interface User {
  id: string;
  username: string;
  full_name: string;
  location: string;
  company: string;
  profile_url: string;
  date_joined: string;
  gravatar_url: string;
  gravatar_email: string;
  type: string;
}

// ============================================
// Example Resource Types (for compatibility)
// ============================================

export interface ExampleResource {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExampleListResponse {
  items: ExampleResource[];
  nextPageToken?: string;
  total?: number;
}

export interface ExampleCreateParams {
  name: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class DockerApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'DockerApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// Legacy alias for compatibility
export { DockerApiError as ConnectorApiError };

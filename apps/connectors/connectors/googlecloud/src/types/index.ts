// Google Cloud Connector Types

// ============================================
// Configuration
// ============================================

export interface GoogleCloudConfig {
  apiKey?: string;
  credentialsPath?: string; // Path to service account JSON file
  baseUrl?: string;         // Override default base URL
}

// For backward compatibility with scaffold pattern
export type ConnectorConfig = GoogleCloudConfig;

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  nextPageToken?: string;
  hasMore: boolean;
}

// ============================================
// Project Types (Resource Manager API)
// ============================================

export interface Project {
  projectNumber: string;
  projectId: string;
  lifecycleState: 'LIFECYCLE_STATE_UNSPECIFIED' | 'ACTIVE' | 'DELETE_REQUESTED' | 'DELETE_IN_PROGRESS';
  name: string;
  createTime: string;
  labels?: Record<string, string>;
  parent?: ResourceId;
}

export interface ResourceId {
  type: string;  // e.g., "organization", "folder"
  id: string;
}

export interface ProjectListResponse {
  projects?: Project[];
  nextPageToken?: string;
}

export interface ProjectCreateParams {
  projectId: string;
  name: string;
  labels?: Record<string, string>;
  parent?: ResourceId;
}

// For backward compatibility with scaffold pattern
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

export class GoogleCloudApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'GoogleCloudApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// For backward compatibility with scaffold pattern
export { GoogleCloudApiError as ConnectorApiError };

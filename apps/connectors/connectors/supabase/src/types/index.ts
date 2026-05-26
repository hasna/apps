// Supabase Connector Types

// ============================================
// Configuration
// ============================================

export interface SupabaseConfig {
  projectUrl: string;
  serviceRoleKey?: string;
  anonKey?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Auth Types
// ============================================

export interface User {
  id: string;
  aud: string;
  role?: string;
  email?: string;
  email_confirmed_at?: string;
  phone?: string;
  phone_confirmed_at?: string;
  confirmed_at?: string;
  last_sign_in_at?: string;
  app_metadata: {
    provider?: string;
    providers?: string[];
    [key: string]: unknown;
  };
  user_metadata: Record<string, unknown>;
  identities?: Identity[];
  created_at: string;
  updated_at: string;
  is_anonymous?: boolean;
  banned_until?: string;
}

export interface Identity {
  id: string;
  user_id: string;
  identity_data: Record<string, unknown>;
  identity_id: string;
  provider: string;
  created_at: string;
  last_sign_in_at: string;
  updated_at: string;
}

export interface Session {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at?: number;
  refresh_token: string;
  user: User;
}

export interface AuthResponse {
  user: User | null;
  session: Session | null;
}

export interface AdminUserAttributes {
  email?: string;
  phone?: string;
  password?: string;
  email_confirm?: boolean;
  phone_confirm?: boolean;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  ban_duration?: string;
  role?: string;
}

export interface ListUsersResult {
  users: User[];
  aud?: string;
  nextPage?: number;
  lastPage?: number;
  total?: number;
}

export interface Factor {
  id: string;
  friendly_name?: string;
  factor_type: 'totp' | 'phone';
  status: 'verified' | 'unverified';
  created_at: string;
  updated_at: string;
}

// ============================================
// Storage Types
// ============================================

export interface Bucket {
  id: string;
  name: string;
  owner?: string;
  created_at: string;
  updated_at: string;
  public: boolean;
  file_size_limit?: number;
  allowed_mime_types?: string[];
}

export interface FileObject {
  id: string;
  name: string;
  bucket_id: string;
  owner?: string;
  created_at: string;
  updated_at: string;
  last_accessed_at?: string;
  metadata: Record<string, unknown>;
}

export interface SignedUrl {
  signedUrl: string;
  token?: string;
  path?: string;
}

export interface UploadResult {
  id: string;
  path: string;
  fullPath: string;
}

// ============================================
// Database Types (REST API)
// ============================================

export interface TableInfo {
  table_name: string;
  table_schema: string;
  table_type: string;
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default?: string;
  table_name: string;
  table_schema: string;
}

// ============================================
// Edge Functions Types
// ============================================

export interface EdgeFunction {
  id: string;
  slug: string;
  name: string;
  version: number;
  created_at: string;
  updated_at: string;
  status: 'ACTIVE' | 'INACTIVE' | 'THROTTLED';
  verify_jwt: boolean;
}

// ============================================
// Project Settings Types
// ============================================

export interface ProjectSettings {
  name: string;
  ref: string;
  organization_id: string;
  cloud_provider: string;
  region: string;
  created_at: string;
  database: {
    host: string;
    version: string;
  };
}

// ============================================
// API Error Types
// ============================================

export interface SupabaseErrorResponse {
  error?: string;
  error_description?: string;
  message?: string;
  msg?: string;
  code?: string;
  hint?: string;
  details?: string;
}

export class SupabaseApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly hint?: string;

  constructor(message: string, statusCode: number, code?: string, hint?: string) {
    super(message);
    this.name = 'SupabaseApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.hint = hint;
  }
}

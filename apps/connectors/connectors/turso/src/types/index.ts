// Turso Platform API connector types

export interface TursoConfig {
  apiKey: string;
  organization: string;
}

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Error
// ============================================

export class TursoApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'TursoApiError';
  }
}

// ============================================
// Organization
// ============================================

export interface Organization {
  name: string;
  slug: string;
  type: 'personal' | 'team';
  overages?: boolean;
  require_mfa?: boolean;
  blocked_reads?: boolean;
  blocked_writes?: boolean;
  plan_id?: string;
  plan_timeline?: string;
  platform?: string;
}

// ============================================
// Database
// ============================================

export interface DatabaseParent {
  id: string;
  name: string;
  branched_at?: string;
}

export interface Database {
  Name: string;
  DbId: string;
  Hostname: string;
  block_reads?: boolean;
  block_writes?: boolean;
  primaryRegion?: string;
  group?: string;
  delete_protection?: boolean;
  parent?: DatabaseParent | null;
}

export interface DatabaseListResponse {
  databases: Database[];
}

export interface CreateDatabaseParams {
  name: string;
  group: string;
  seed?: {
    type: 'database' | 'database_upload';
    name?: string;
    timestamp?: string;
  };
  size_limit?: string;
  remote_encryption?: {
    encryption_key: string;
    encryption_cipher: string;
  };
}

export interface CreateDatabaseResponse {
  database: Database;
}

export interface DeleteDatabaseResponse {
  database: string;
}

// ============================================
// Group
// ============================================

export interface Group {
  name: string;
  primary: string;
  locations?: string[];
  archived?: boolean;
}

export interface GroupListResponse {
  groups: Group[];
}

// ============================================
// Usage
// ============================================

export interface UsageQuota {
  rows_read?: number;
  rows_written?: number;
  databases?: number;
  locations?: number;
  storage_bytes?: number;
  groups?: number;
  bytes_synced?: number;
}

export interface DatabaseUsageObject {
  rows_read?: number;
  rows_written?: number;
  storage_bytes?: number;
  bytes_synced?: number;
}

export interface DatabaseInstanceUsage {
  uuid: string;
  usage: DatabaseUsageObject;
}

export interface DatabaseUsageOutput {
  uuid: string;
  instances?: DatabaseInstanceUsage[];
  total?: DatabaseUsageObject;
}

export interface OrganizationUsage {
  uuid: string;
  usage: UsageQuota;
  databases: DatabaseUsageOutput[];
}

export interface OrganizationUsageResponse {
  organization: OrganizationUsage;
}

// ============================================
// Auth
// ============================================

export interface ValidateTokenResponse {
  exp: number;
}

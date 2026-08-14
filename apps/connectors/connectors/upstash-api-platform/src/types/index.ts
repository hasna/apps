// Upstash Developer API connector types

export interface UpstashApiPlatformConfig {
  email: string;
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface Team {
  team_id: string;
  team_name: string;
  copy_cc?: boolean;
}

export interface CreateTeamRequest {
  team_name: string;
  copy_cc: boolean;
}

export interface TeamMember {
  team_id: string;
  team_name: string;
  member_email: string;
  member_role: 'owner' | 'admin' | 'dev' | 'finance';
  copy_cc?: boolean;
}

export interface VectorIndex {
  id: string;
  name: string;
  customer_id?: string;
  similarity_function?: 'COSINE' | 'EUCLIDEAN' | 'DOT_PRODUCT';
  dimension_count?: number;
  embedding_model?: string;
  sparse_embedding_model?: string;
  endpoint?: string;
  token?: string;
  read_only_token?: string;
  type?: 'free' | 'payg' | 'fixed';
  region?: 'eu-west-1' | 'us-east-1' | 'us-central1';
  index_type?: 'DENSE' | 'SPARSE' | 'HYBRID';
  creation_time?: number;
  [key: string]: unknown;
}

export interface CreateIndexRequest {
  name: string;
  region: 'eu-west-1' | 'us-east-1' | 'us-central1';
  similarity_function: 'COSINE' | 'EUCLIDEAN' | 'DOT_PRODUCT';
  dimension_count: number;
  type?: 'payg' | 'fixed' | 'paid';
  embedding_model?: string;
  index_type?: 'DENSE' | 'SPARSE' | 'HYBRID';
  sparse_embedding_model?: string;
}

export interface AuditLog {
  log_id: string;
  customer_id?: string;
  actor?: string;
  timestamp?: number;
  action?: number;
  action_string?: string;
  source?: string;
  entity?: string;
  secondary_entity?: string;
  third_entity?: string;
  readable_format?: string;
  ip?: string;
  ttl?: number;
  reason?: string;
  notes?: string;
}

export class UpstashApiError extends Error {
  public readonly statusCode: number;
  public readonly body?: unknown;

  constructor(message: string, statusCode: number, body?: unknown) {
    super(message);
    this.name = 'UpstashApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

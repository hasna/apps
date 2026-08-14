export interface WorkOSConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface WorkOSListMetadata {
  before?: string | null;
  after?: string | null;
}

export interface WorkOSListResponse<T> {
  object: 'list';
  data: T[];
  list_metadata: WorkOSListMetadata;
}

export interface OrganizationDomain {
  id: string;
  domain: string;
  state?: string;
}

export interface Organization {
  object: 'organization';
  id: string;
  name: string;
  domains: OrganizationDomain[];
  metadata?: Record<string, string>;
  external_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Connection {
  object: 'connection';
  id: string;
  organization_id: string;
  connection_type: string;
  name: string;
  state: string;
  domains: OrganizationDomain[];
  created_at: string;
  updated_at: string;
}

export interface Directory {
  object: 'directory';
  id: string;
  organization_id: string;
  external_key: string;
  type: string;
  state: string;
  name: string;
  domain?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DirectoryUser {
  object: 'directory_user';
  id: string;
  directory_id: string;
  organization_id: string;
  idp_id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  emails: Array<{ primary?: boolean; type?: string; value: string }>;
  state: string;
  created_at: string;
  updated_at: string;
}

export interface WorkOSEvent {
  id: string;
  event: string;
  data: Record<string, unknown>;
  created_at: string;
}

export class WorkOSApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'WorkOSApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

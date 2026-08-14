// Vanta Manage API Types

export interface VantaConfig {
  clientId: string;
  clientSecret: string;
  scope?: string;
  baseUrl?: string;
}

export interface ProfileConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface PageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
}

export interface PaginatedResults<T> {
  data: T[];
  pageInfo: PageInfo;
  totalCount?: number;
}

export interface PaginatedResponse<T> {
  results: PaginatedResults<T>;
}

export interface ControlOwner {
  id: string;
  displayName: string;
  emailAddress: string;
}

export interface ControlCustomField {
  label: string;
  value: string | string[];
}

export interface Control {
  id: string;
  externalId: string | null;
  name: string;
  description: string;
  source: string;
  domains: string[];
  owner: ControlOwner | null;
  role: string | null;
  customFields: ControlCustomField[];
  creationDate: string | null;
  modificationDate: string | null;
}

export interface CreateControlInput {
  name: string;
  description: string;
  externalId?: string;
  domains?: string[];
  ownerId?: string;
  role?: string;
  customFields?: ControlCustomField[];
}

export interface EventLogInitiator {
  type: string;
  id: string;
}

export interface EventLog {
  id: string;
  date: string;
  action: string;
  initiator: EventLogInitiator;
  [key: string]: unknown;
}

export interface Document {
  id: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ListControlsParams {
  pageSize?: number;
  pageCursor?: string;
  frameworkMatchesAny?: string[];
}

export interface ListEventsParams {
  pageSize?: number;
  pageCursor?: string;
  startDate?: string;
}

export interface SearchDocumentsParams {
  pageSize?: number;
  pageCursor?: string;
  frameworkMatchesAny?: string[];
  statusMatchesAny?: string[];
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown> | unknown[];
  query?: Record<string, string | number | boolean | string[] | undefined>;
}

export class VantaApiError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'VantaApiError';
    this.status = status;
  }
}

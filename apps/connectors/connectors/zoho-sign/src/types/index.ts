export type ZohoSignDataCenter = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca';

export interface ZohoSignConfig {
  token: string;
  dataCenter?: ZohoSignDataCenter | string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ZohoSignRequest {
  request_id: string;
  request_name: string;
  request_status?: string;
  owner_email?: string;
  owner_name?: string;
  created_time?: number;
  modified_time?: number;
  description?: string;
  folder_id?: string;
  [key: string]: unknown;
}

export interface ZohoSignTemplate {
  template_id: string;
  template_name: string;
  created_time?: number;
  modified_time?: number;
  description?: string;
  [key: string]: unknown;
}

export interface ZohoSignFolder {
  folder_id: string;
  folder_name: string;
  created_time?: number;
  [key: string]: unknown;
}

export interface ZohoSignUser {
  user_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ZohoSignWebhook {
  webhook_id: string;
  webhook_name: string;
  webhook_url: string;
  events?: string[];
  [key: string]: unknown;
}

export interface ZohoSignAccount {
  account_id?: string;
  account_name?: string;
  [key: string]: unknown;
}

export interface ZohoSignFieldType {
  field_type_id?: string;
  field_type_name?: string;
  [key: string]: unknown;
}

export interface ZohoSignTag {
  tag_id?: string;
  tag_name?: string;
  [key: string]: unknown;
}

export interface ZohoSignApiResponse<T = unknown> {
  status: 'success' | 'failure';
  message?: string;
  code?: number | string;
  [key: string]: unknown;
  requests?: T;
  templates?: T;
  folders?: T;
  users?: T;
  webhooks?: T;
  account?: T;
  fieldtypes?: T;
  tags?: T;
}

export class ZohoSignApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: number | string;

  constructor(message: string, statusCode: number, code?: number | string) {
    super(message);
    this.name = 'ZohoSignApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ProfileConfig {
  token?: string;
  dataCenter?: string;
  baseUrl?: string;
}

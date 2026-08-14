export type ZohoFormsDataCenter = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca' | 'sa';

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ZohoFormsConfig {
  token: string;
  dataCenter?: ZohoFormsDataCenter | string;
  baseUrl?: string;
}

export interface ZohoForm {
  link_name: string;
  display_name?: string;
  [key: string]: unknown;
}

export interface ZohoFormField {
  link_name: string;
  display_name?: string;
  type?: string;
  [key: string]: unknown;
}

export interface ZohoFormReport {
  link_name: string;
  display_name?: string;
  [key: string]: unknown;
}

export interface ZohoFormEntry {
  entry_id: string;
  [key: string]: unknown;
}

export interface ZohoWorkspace {
  workspace_id: string;
  workspace_name?: string;
  [key: string]: unknown;
}

export interface ZohoFormTheme {
  theme_id: string;
  theme_name?: string;
  [key: string]: unknown;
}

export interface ZohoFormWebhook {
  webhook_id: string;
  url?: string;
  [key: string]: unknown;
}

export interface ZohoFormTask {
  task_id: string;
  status?: string;
  [key: string]: unknown;
}

export interface ZohoFormPayment {
  payment_id: string;
  [key: string]: unknown;
}

export interface ZohoSharedUser {
  email: string;
  role?: string;
  [key: string]: unknown;
}

export interface ZohoFormsListResponse<T> {
  data?: T[];
  forms?: T[];
  entries?: T[];
  workspaces?: T[];
  themes?: T[];
  webhooks?: T[];
  tasks?: T[];
  payments?: T[];
  users?: T[];
  [key: string]: unknown;
}

export class ZohoFormsApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'ZohoFormsApiError';
    this.statusCode = statusCode;
    this.code = code;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

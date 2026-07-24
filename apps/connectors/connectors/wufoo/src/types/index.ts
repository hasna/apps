// Wufoo API v3 types
// Docs: https://wufoo.github.io/docs/

export interface WufooConfig {
  apiKey: string;
  subdomain: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ListParams {
  page?: number;
  limit?: number;
  pretty?: boolean;
  includeTodayCount?: boolean;
}

export interface EntryListParams extends ListParams {
  sort?: string;
  sortDirection?: 'ASC' | 'DESC';
  /** Filter1..FilterN query params keyed by filter index (1-based) */
  filters?: Record<string, string>;
}

export interface WufooForm {
  Name: string;
  Description: string;
  Url: string;
  LinkEntries: string;
  IsPublic: string;
  Language: string;
  StartDate: string;
  EndDate: string;
  DateCreated: string;
  DateUpdated: string;
  Hash: string;
  LinkFields: string;
  LinkEntriesCount: string;
  TodayEntries?: string;
}

export interface WufooFormsResponse {
  Forms: WufooForm[];
}

export interface WufooFormResponse {
  Form: WufooForm;
}

export interface WufooField {
  ID: string;
  Title: string;
  Instructions: string;
  IsRequired: string;
  ClassNames: string;
  DefaultVal: string;
  Page: string;
  Type: string;
  HasOtherField: boolean;
  Choices?: Record<string, string> | string[];
}

export interface WufooFieldsResponse {
  Fields: WufooField[];
}

export interface WufooEntry {
  EntryId: string;
  DateCreated: string;
  CreatedBy: string;
  DateUpdated: string;
  UpdatedBy: string | null;
  [fieldKey: string]: string | null | undefined;
}

export interface WufooEntriesResponse {
  Entries: WufooEntry[];
}

export interface WufooEntryCountResponse {
  EntryCount: number;
}

export interface WufooSubmitEntryResponse {
  Success: number;
  EntryId: number;
  EntryLink: string;
  RedirectUrl?: string;
}

export interface WufooComment {
  CommentId: string;
  EntryId: string;
  DateCreated: string;
  CreatedBy: string;
  Text: string;
}

export interface WufooCommentsResponse {
  Comments: WufooComment[];
}

export interface WufooCommentsCountResponse {
  CommentCount: number;
}

export interface WufooReport {
  Name: string;
  Description: string;
  Url: string;
  LinkEntries: string;
  LinkFields: string;
  LinkEntriesCount: string;
  Hash: string;
}

export interface WufooReportsResponse {
  Reports: WufooReport[];
}

export interface WufooReportResponse {
  Report: WufooReport;
}

export interface WufooWidget {
  Hash: string;
  Name: string;
  Type: string;
  Url: string;
}

export interface WufooWidgetsResponse {
  Widgets: WufooWidget[];
}

export interface WufooUser {
  User: string;
  Email: string;
  TimeZone: string;
  IsAccountOwner: string;
  LinkForms: string;
  LinkReports: string;
}

export interface WufooUsersResponse {
  Users: WufooUser[];
}

export interface WufooWebhookPutParams {
  url: string;
  handshakeKey?: string;
  metadata?: boolean | string;
}

export interface WufooWebhookPutResponse {
  WebHookPutResult: {
    Hash: string;
  };
}

export interface WufooWebhookDeleteResponse {
  WebHookDeleteResult: {
    Hash: string;
  };
}

export class WufooApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WufooApiError';
    this.statusCode = statusCode;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }
}

export function parseWufooError(response: unknown, statusCode: number): WufooApiError {
  if (typeof response === 'string') {
    return new WufooApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new WufooApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.Text as string) ||
    (data.message as string) ||
    (data.error as string) ||
    `HTTP ${statusCode} Error`;

  return new WufooApiError(message, statusCode);
}

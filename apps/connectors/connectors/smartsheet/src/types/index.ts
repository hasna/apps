// Smartsheet Connector Types

export interface SmartsheetConfig {
  accessToken: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface SmartsheetErrorResponse {
  errorCode?: number;
  message?: string;
  refId?: string;
}

export class SmartsheetApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: number;
  public readonly refId?: string;

  constructor(message: string, statusCode: number, errorCode?: number, refId?: string) {
    super(message);
    this.name = 'SmartsheetApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.refId = refId;
  }
}

// ============================================
// Pagination
// ============================================

export interface PaginatedResult<T> {
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  data: T[];
}

// ============================================
// Sheet Types
// ============================================

export interface SheetSummary {
  id: number;
  name: string;
  accessLevel: string;
  permalink?: string;
  createdAt?: string;
  modifiedAt?: string;
}

export interface ListSheetsResult {
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  data: SheetSummary[];
}

export interface Cell {
  columnId: number;
  value?: unknown;
  displayValue?: string;
  formula?: string;
}

export interface Row {
  id: number;
  rowNumber: number;
  cells?: Cell[];
  expanded?: boolean;
  createdAt?: string;
  modifiedAt?: string;
}

export interface Column {
  id: number;
  version: number;
  index: number;
  title: string;
  type: string;
  primary?: boolean;
  width?: number;
}

export interface Sheet extends SheetSummary {
  version: number;
  columns?: Column[];
  rows?: Row[];
  totalRowCount?: number;
}

// ============================================
// Folder Types
// ============================================

export interface Folder {
  id: number;
  name: string;
  permalink?: string;
}

export interface ListFoldersResult {
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  data: Folder[];
}

// ============================================
// Workspace Types
// ============================================

export interface Workspace {
  id: number;
  name: string;
  accessLevel: string;
  permalink?: string;
}

export interface ListWorkspacesResult {
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  data: Workspace[];
}

// ============================================
// Report Types
// ============================================

export interface ReportSummary {
  id: number;
  name: string;
  accessLevel: string;
  permalink?: string;
}

export interface ListReportsResult {
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  data: ReportSummary[];
}

// ============================================
// Webhook Types
// ============================================

export interface Webhook {
  id: number;
  name: string;
  callbackUrl: string;
  scope: string;
  scopeObjectId: number;
  events: string[];
  version: number;
  enabled: boolean;
  status: string;
}

export interface ListWebhooksResult {
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  data: Webhook[];
}

// ============================================
// User Types
// ============================================

export interface User {
  id: number;
  email: string;
  firstName?: string;
  lastName?: string;
  admin?: boolean;
  licensedSheetCreator?: boolean;
}

export interface ListUsersResult {
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  data: User[];
}

// ============================================
// Discussion Types
// ============================================

export interface Discussion {
  id: number;
  title?: string;
  commentCount?: number;
  createdAt?: string;
}

export interface ListDiscussionsResult {
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  data: Discussion[];
}

// ============================================
// Attachment Types
// ============================================

export interface Attachment {
  id: number;
  name: string;
  attachmentType: string;
  mimeType?: string;
  sizeInKb?: number;
  url?: string;
}

export interface ListAttachmentsResult {
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  data: Attachment[];
}

// ============================================
// Contact Types
// ============================================

export interface Contact {
  id: number;
  name?: string;
  email: string;
}

export interface ListContactsResult {
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  data: Contact[];
}

// ============================================
// Automation Types
// ============================================

export interface AutomationRule {
  id: string;
  action: string;
  enabled: boolean;
}

export interface ListAutomationRulesResult {
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  data: AutomationRule[];
}

// ============================================
// Request parameter types
// ============================================

export interface CreateSheetParams {
  name: string;
  columns: Array<Record<string, unknown>>;
  folderId?: number;
  workspaceId?: number;
}

export interface AddRowsParams {
  sheetId: number;
  rows: Array<Record<string, unknown>>;
  toTop?: boolean;
  toBottom?: boolean;
  aboveRowId?: number;
  belowRowId?: number;
}

export interface UpdateRowsParams {
  sheetId: number;
  rows: Array<{ id: number; cells?: Array<Record<string, unknown>>; locked?: boolean }>;
}

export interface CreateWebhookParams {
  name: string;
  callbackUrl: string;
  scope: 'sheet';
  scopeObjectId: number;
  events: string[];
  version?: number;
}

export interface InviteUserParams {
  email: string;
  admin?: boolean;
  licensedSheetCreator?: boolean;
  firstName?: string;
  lastName?: string;
  sendEmail?: boolean;
}

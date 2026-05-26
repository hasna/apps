// PandaDoc API Types

// ============================================
// Configuration
// ============================================

export interface PandaDocConfig {
  apiKey?: string;
  accessToken?: string; // OAuth bearer token
  baseUrl?: string;     // Override default base URL
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  results: T[];
  count?: number;
  next?: string;
  previous?: string;
}

// ============================================
// Document Types
// ============================================

export type DocumentStatus =
  | 'document.draft'
  | 'document.sent'
  | 'document.viewed'
  | 'document.waiting_approval'
  | 'document.approved'
  | 'document.waiting_pay'
  | 'document.paid'
  | 'document.completed'
  | 'document.voided'
  | 'document.declined'
  | 'document.external_review';

export interface Document {
  id: string;
  name: string;
  status: DocumentStatus;
  date_created: string;
  date_modified: string;
  date_completed?: string;
  expiration_date?: string;
  version?: string;
  uuid?: string;
  template?: {
    id: string;
    name: string;
  };
  auditTrail?: AuditTrailItem[];
  metadata?: Record<string, string>;
  tokens?: Token[];
  fields?: Field[];
  pricing?: PricingTable;
  tags?: string[];
  sent_by?: User;
  grand_total?: {
    amount: string;
    currency: string;
  };
}

export interface DocumentListItem {
  id: string;
  name: string;
  status: DocumentStatus;
  date_created: string;
  date_modified: string;
  date_completed?: string;
  expiration_date?: string;
  version?: string;
}

export interface DocumentListResponse {
  results: DocumentListItem[];
  count?: number;
}

export interface AuditTrailItem {
  timestamp: string;
  event: string;
  data?: Record<string, unknown>;
}

export interface Token {
  name: string;
  value: string;
}

export interface Field {
  uuid: string;
  name: string;
  title?: string;
  value?: unknown;
  assigned_to?: Recipient;
}

export interface PricingTable {
  name?: string;
  sections: PricingSection[];
  total?: string;
}

export interface PricingSection {
  title?: string;
  rows: PricingRow[];
  subtotal?: string;
}

export interface PricingRow {
  id?: string;
  options?: {
    optional: boolean;
    optional_selected: boolean;
    qty_editable: boolean;
  };
  data?: Record<string, unknown>;
}

export interface Recipient {
  id?: string;
  email: string;
  first_name?: string;
  last_name?: string;
  recipient_type?: 'signer' | 'CC' | 'approver';
  role?: string;
  signing_order?: number;
  has_completed?: boolean;
}

export interface User {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  avatar?: string;
  membership_id?: string;
}

export interface DocumentCreateParams {
  name: string;
  template_uuid?: string;
  folder_uuid?: string;
  recipients?: Recipient[];
  tokens?: Token[];
  fields?: Record<string, { value: unknown }>;
  metadata?: Record<string, string>;
  tags?: string[];
  images?: Array<{
    urls: string[];
    name: string;
  }>;
  pricing_tables?: PricingTable[];
  content_placeholders?: Array<{
    block_id: string;
    content_library_items: Array<{
      id: string;
      pricing_tables?: PricingTable[];
    }>;
  }>;
  url?: string; // For document from URL
  parse_form_fields?: boolean;
}

export interface DocumentSendParams {
  message?: string;
  subject?: string;
  silent?: boolean;
  sender?: {
    email: string;
  };
  forwarding_settings?: {
    forwarding_allowed: boolean;
    forwarding_with_reassigning_allowed: boolean;
  };
}

// ============================================
// Template Types
// ============================================

export interface Template {
  id: string;
  name: string;
  date_created: string;
  date_modified: string;
  version?: string;
  content_date_modified?: string;
}

export interface TemplateDetails extends Template {
  tokens?: Token[];
  fields?: Field[];
  roles?: Array<{
    id: string;
    name: string;
    signing_order?: number;
  }>;
  images?: Array<{
    name: string;
    block_uuid: string;
  }>;
  content_placeholders?: Array<{
    uuid: string;
    block_id: string;
    name?: string;
    description?: string;
  }>;
  pricing?: PricingTable;
  tags?: string[];
}

export interface TemplateListResponse {
  results: Template[];
  count?: number;
}

// ============================================
// Contact Types
// ============================================

export interface Contact {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  phone?: string;
  state?: string;
  street_address?: string;
  city?: string;
  postal_code?: string;
  country?: string;
}

export interface ContactCreateParams {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  phone?: string;
  state?: string;
  street_address?: string;
  city?: string;
  postal_code?: string;
  country?: string;
}

export interface ContactListResponse {
  results: Contact[];
  count?: number;
}

// ============================================
// Folder Types
// ============================================

export interface Folder {
  uuid: string;
  name: string;
  date_created: string;
  date_modified?: string;
  created_by?: User;
  parent_uuid?: string;
}

export interface FolderCreateParams {
  name: string;
  parent_uuid?: string;
}

export interface FolderListResponse {
  results: Folder[];
  count?: number;
}

// ============================================
// Member Types
// ============================================

export interface Member {
  user_id: string;
  membership_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  is_active: boolean;
  workspace: string;
  workspace_name?: string;
  role?: string;
  date_created?: string;
  date_modified?: string;
}

export interface MemberListResponse {
  results: Member[];
  count?: number;
}

// ============================================
// Webhook Types
// ============================================

export interface Webhook {
  uuid: string;
  name: string;
  url: string;
  active: boolean;
  shared_key?: string;
  events: string[];
  date_created?: string;
  date_modified?: string;
}

export interface WebhookCreateParams {
  name: string;
  url: string;
  events: string[];
  active?: boolean;
}

export interface WebhookListResponse {
  results: Webhook[];
  count?: number;
}

export interface WebhookSharedKeyResponse {
  shared_key: string;
}

// ============================================
// Form Types
// ============================================

export interface Form {
  id: string;
  name: string;
  status: string;
  date_created: string;
  date_modified: string;
  number_of_submissions?: number;
}

export interface FormListResponse {
  results: Form[];
  count?: number;
}

// ============================================
// Catalog / Pricing Types
// ============================================

export interface CatalogItem {
  id: string;
  name: string;
  description?: string;
  sku?: string;
  price?: {
    value: string;
    currency: string;
  };
  date_created?: string;
  date_modified?: string;
}

export interface CatalogItemCreateParams {
  name: string;
  description?: string;
  sku?: string;
  price?: {
    value: string;
    currency: string;
  };
}

export interface CatalogListResponse {
  results: CatalogItem[];
  count?: number;
}

// ============================================
// Content Library Types
// ============================================

export interface ContentLibraryItem {
  id: string;
  name: string;
  date_created: string;
  date_modified: string;
  content_date_modified?: string;
  created_by?: User;
}

export interface ContentLibraryItemDetails extends ContentLibraryItem {
  pricing_tables?: PricingTable[];
  tags?: string[];
}

export interface ContentLibraryListResponse {
  results: ContentLibraryItem[];
  count?: number;
}

// ============================================
// Document Attachment Types
// ============================================

export interface DocumentAttachment {
  uuid: string;
  name: string;
  date_created: string;
  source?: string;
}

export interface DocumentAttachmentCreateParams {
  name: string;
  file: string; // base64 encoded file or URL
  source?: 'file' | 'url';
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class PandaDocApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];
  public readonly type?: string;
  public readonly detail?: string;

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[], type?: string, detail?: string) {
    super(message);
    this.name = 'PandaDocApiError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.type = type;
    this.detail = detail;
  }
}

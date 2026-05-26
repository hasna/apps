// HelloSign (Dropbox Sign) Connector Types

// ============================================
// Configuration
// ============================================

export interface HelloSignConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Signature Request Types
// ============================================

export interface SignatureRequest {
  signature_request_id: string;
  title: string;
  original_title: string;
  subject: string;
  message: string;
  is_complete: boolean;
  is_declined: boolean;
  has_error: boolean;
  custom_fields?: CustomField[];
  response_data?: ResponseData[];
  signing_url?: string;
  signing_redirect_url?: string;
  final_copy_uri?: string;
  files_url?: string;
  details_url?: string;
  requester_email_address: string;
  signatures: Signature[];
  cc_email_addresses?: string[];
  created_at: number;
  expires_at?: number;
}

export interface Signature {
  signature_id: string;
  signer_email_address: string;
  signer_name: string;
  signer_role?: string;
  order?: number;
  status_code: string;
  signed_at?: number;
  last_viewed_at?: number;
  last_reminded_at?: number;
  has_pin: boolean;
  has_sms_auth: boolean;
  has_sms_delivery: boolean;
  sms_phone_number?: string;
  error?: string;
}

export interface CustomField {
  name: string;
  type: string;
  value?: string;
  required?: boolean;
  editor?: string;
}

export interface ResponseData {
  api_id: string;
  signature_id: string;
  name: string;
  value: string;
  required: boolean;
  type: string;
}

export interface SignatureRequestListResponse {
  signature_requests: SignatureRequest[];
  list_info: ListInfo;
}

export interface ListInfo {
  num_pages: number;
  num_results: number;
  page: number;
  page_size: number;
}

// ============================================
// Signer Types
// ============================================

export interface Signer {
  email_address: string;
  name: string;
  role?: string;
  order?: number;
  pin?: string;
  sms_phone_number?: string;
  sms_phone_number_type?: 'authentication' | 'delivery';
}

// ============================================
// Template Types
// ============================================

export interface Template {
  template_id: string;
  title: string;
  message?: string;
  signer_roles: SignerRole[];
  cc_roles?: CcRole[];
  documents?: TemplateDocument[];
  custom_fields?: CustomField[];
  named_form_fields?: NamedFormField[];
  accounts?: Account[];
  is_creator: boolean;
  is_embedded: boolean;
  can_edit: boolean;
  is_locked: boolean;
  metadata?: Record<string, string>;
  created_at: number;
  updated_at: number;
}

export interface SignerRole {
  name: string;
  order?: number;
}

export interface CcRole {
  name: string;
}

export interface TemplateDocument {
  name: string;
  index: number;
  field_groups?: FieldGroup[];
  form_fields?: FormField[];
  custom_fields?: CustomField[];
}

export interface FieldGroup {
  name: string;
  rule: string;
}

export interface FormField {
  api_id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  signer?: number;
  page?: number;
}

export interface NamedFormField {
  name: string;
  type: string;
  signer: string;
  required: boolean;
}

export interface TemplateListResponse {
  templates: Template[];
  list_info: ListInfo;
}

// ============================================
// Account Types
// ============================================

export interface Account {
  account_id: string;
  email_address: string;
  is_locked: boolean;
  is_paid_hs: boolean;
  is_paid_hf: boolean;
  quotas: AccountQuotas;
  callback_url?: string;
  role_code?: string;
  locale?: string;
}

export interface AccountQuotas {
  templates_total: number;
  templates_left: number;
  api_signature_requests_left: number;
  documents_left: number;
  sms_verifications_left: number;
}

// ============================================
// Team Types
// ============================================

export interface Team {
  name: string;
  accounts: TeamAccount[];
  invited_accounts?: TeamAccount[];
}

export interface TeamAccount {
  account_id: string;
  email_address: string;
  role_code: string;
}

// ============================================
// Create Signature Request Options
// ============================================

export interface CreateSignatureRequestOptions {
  signers: Signer[];
  title?: string;
  subject?: string;
  message?: string;
  cc_email_addresses?: string[];
  file_urls?: string[];
  use_text_tags?: boolean;
  hide_text_tags?: boolean;
  metadata?: Record<string, string>;
  signing_redirect_url?: string;
  test_mode?: boolean;
}

export interface CreateFromTemplateOptions {
  template_id: string;
  signers: Array<{
    email_address: string;
    name: string;
    role: string;
  }>;
  ccs?: Array<{
    email_address: string;
    role: string;
  }>;
  title?: string;
  subject?: string;
  message?: string;
  signing_redirect_url?: string;
  metadata?: Record<string, string>;
  test_mode?: boolean;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class HelloSignApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'HelloSignApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

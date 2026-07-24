// Yousign API v3 connector types

export type YousignEnvironment = 'production' | 'sandbox';

export interface YousignConfig {
  apiKey: string;
  environment?: YousignEnvironment;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type SignatureRequestStatus =
  | 'draft'
  | 'ongoing'
  | 'done'
  | 'expired'
  | 'canceled'
  | 'rejected'
  | 'approval';

export type DeliveryMode = 'email' | 'none';

export type SignatureLevel =
  | 'electronic_signature'
  | 'advanced_electronic_signature'
  | 'qualified_electronic_signature'
  | 'qualified_electronic_signature_mode_1';

export type SignatureAuthenticationMode = 'no_otp' | 'otp_email' | 'otp_sms';

export type SignatureImagePreference = 'auto' | 'cursive_font_only' | 'drawing_or_cursive_font';

export type FieldType =
  | 'signature'
  | 'mention'
  | 'text'
  | 'checkbox'
  | 'radio_group'
  | 'read_only_text';

export type DocumentVersion = 'completed' | 'current';

export interface PaginatedMeta {
  next_cursor?: string;
  prev_cursor?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta?: PaginatedMeta;
}

export interface SignerInfo {
  first_name: string;
  last_name: string;
  email: string;
  phone_number?: string;
  locale?: string;
}

export interface SignatureRequest {
  id: string;
  name: string;
  status: SignatureRequestStatus;
  delivery_mode: DeliveryMode;
  created_at: string;
  expiration_date?: string;
  external_id?: string;
  workspace_id?: string;
}

export interface Signer {
  id: string;
  info: SignerInfo;
  signature_level: SignatureLevel;
  status?: string;
}

export interface Document {
  id: string;
  filename: string;
  nature: string;
}

export interface Field {
  id: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  signer_id?: string;
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  created_at: string;
}

export interface Webhook {
  id: string;
  url: string;
  description?: string;
  subscribed_events: string[];
  sandbox?: boolean;
}

export interface User {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
}

export interface ConsentRequest {
  id: string;
  status: string;
  created_at: string;
}

export interface ListSignatureRequestsOptions {
  limit?: number;
  after?: string;
  status?: SignatureRequestStatus;
  from?: string;
  to?: string;
  search?: string;
}

export interface CreateSignatureRequestOptions {
  name: string;
  delivery_mode: DeliveryMode;
  timezone?: string;
  ordered_signers?: boolean;
  reminder_settings?: { interval_in_days?: number; max_occurrences?: number };
  external_id?: string;
  custom_experience_id?: string;
  expiration_date?: string;
  branded?: boolean;
  audit_trail_locale?: string;
  signers_allowed_to_decline?: boolean;
  workspace_id?: string;
}

export interface UpdateSignatureRequestOptions {
  name?: string;
  expiration_date?: string;
  reminder_settings?: Record<string, unknown>;
}

export interface AddSignerOptions {
  info: SignerInfo;
  signature_level: SignatureLevel;
  signature_authentication_mode?: SignatureAuthenticationMode;
  signature_image_preference?: SignatureImagePreference;
}

export interface UpdateSignerOptions {
  info?: Partial<SignerInfo>;
}

export interface AddFieldOptions {
  type: FieldType;
  signer_id?: string;
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  optional?: boolean;
  mention?: string;
  text?: string;
}

export interface CreateWebhookOptions {
  url: string;
  description?: string;
  subscribed_events: string[];
  sandbox?: boolean;
  http_method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  secret_token?: string;
}

export interface ApiViolation {
  message?: string;
  propertyPath?: string;
}

export interface ApiErrorBody {
  title?: string;
  detail?: string;
  message?: string;
  violations?: ApiViolation[];
}

export class YousignApiError extends Error {
  public readonly statusCode: number;
  public readonly body?: ApiErrorBody;

  constructor(message: string, statusCode: number, body?: ApiErrorBody) {
    super(message);
    this.name = 'YousignApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

export function parseYousignErrorMessage(body: ApiErrorBody, status: number): string {
  const violations = Array.isArray(body.violations) ? body.violations : [];
  const first = violations[0];
  return first?.message ?? body.detail ?? body.title ?? body.message ?? `request failed (${status})`;
}

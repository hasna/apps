// Stripe Terminal Connector Types

export interface ConnectorConfig {
  apiKey: string;
  baseUrl?: string;
  accountId?: string;
  apiVersion?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type Metadata = Record<string, string>;

export interface StripeList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}

export interface ListOptions {
  limit?: number;
  starting_after?: string;
  ending_before?: string;
}

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface DeletedObject {
  id: string;
  object: string;
  deleted: true;
}

// ============================================
// Connection Token
// ============================================

export interface ConnectionToken {
  object: 'terminal.connection_token';
  secret: string;
  location?: string;
  livemode: boolean;
}

export interface ConnectionTokenCreateParams {
  location?: string;
}

// ============================================
// Terminal Location
// ============================================

export interface TerminalLocation {
  id: string;
  object: 'terminal.location';
  address: Address;
  configuration_overrides?: string;
  display_name: string;
  livemode: boolean;
  metadata: Metadata;
}

export interface TerminalLocationCreateParams {
  display_name: string;
  address: Address;
  configuration_overrides?: string;
  metadata?: Metadata;
}

export interface TerminalLocationUpdateParams {
  display_name?: string;
  address?: Address;
  configuration_overrides?: string;
  metadata?: Metadata;
}

export interface TerminalLocationListOptions extends ListOptions {
  starting_after?: string;
  ending_before?: string;
}

// ============================================
// Terminal Reader
// ============================================

export type ReaderStatus =
  | 'offline'
  | 'online'
  | 'unknown';

export type ReaderDeviceType =
  | 'bbpos_wisepad3'
  | 'bbpos_wisepos_e'
  | 'mobile_phone_reader'
  | 'simulated_wisepos_e'
  | 'stripe_m2'
  | 'stripe_s700'
  | 'verifone_P400'
  | string;

export interface TerminalReader {
  id: string;
  object: 'terminal.reader';
  action?: Record<string, unknown> | null;
  device_sw_version?: string | null;
  device_type: ReaderDeviceType;
  ip_address?: string | null;
  label: string;
  last_seen_at?: number | null;
  livemode: boolean;
  location?: string | null;
  metadata: Metadata;
  serial_number: string;
  status?: ReaderStatus | null;
}

export interface TerminalReaderCreateParams {
  registration_code: string;
  label: string;
  location?: string;
  metadata?: Metadata;
}

export interface TerminalReaderUpdateParams {
  label?: string;
  metadata?: Metadata;
}

export interface TerminalReaderListOptions extends ListOptions {
  location?: string;
  status?: ReaderStatus;
  device_type?: ReaderDeviceType;
}

export interface ProcessPaymentIntentParams {
  payment_intent: string;
  process_config?: {
    enable_customer_cancellation?: boolean;
    skip_tipping?: boolean;
    tipping?: Record<string, unknown>;
  };
}

export interface ProcessSetupIntentParams {
  setup_intent: string;
  process_config?: {
    enable_customer_cancellation?: boolean;
  };
}

export interface ProcessRefundParams {
  refund_payment: string;
  amount?: number;
  metadata?: Metadata;
}

// ============================================
// Terminal Configuration
// ============================================

export interface TerminalConfiguration {
  id: string;
  object: 'terminal.configuration';
  is_account_default?: boolean;
  livemode: boolean;
  name?: string | null;
  offline?: Record<string, unknown> | null;
  reboot_window?: Record<string, unknown> | null;
  tipping?: Record<string, unknown> | null;
  verifone_p400?: Record<string, unknown> | null;
  wifi?: Record<string, unknown> | null;
}

export interface TerminalConfigurationCreateParams {
  name?: string;
  tipping?: Record<string, unknown>;
  offline?: Record<string, unknown>;
  reboot_window?: Record<string, unknown>;
  verifone_p400?: Record<string, unknown>;
  wifi?: Record<string, unknown>;
}

export interface TerminalConfigurationUpdateParams extends TerminalConfigurationCreateParams {}

export interface TerminalConfigurationListOptions extends ListOptions {
  is_account_default?: boolean;
}

// ============================================
// Errors
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

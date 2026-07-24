// UpCloud Connector Types

export interface UpCloudConfig {
  /** API username */
  apiKey: string;
  /** API password */
  apiSecret: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface UpCloudErrorEnvelope {
  error?: {
    error_code?: string;
    error_message?: string;
  };
}

export class UpCloudApiError extends Error {
  readonly status: number;
  readonly errorCode?: string;

  constructor(message: string, status: number, errorCode?: string) {
    super(message);
    this.name = 'UpCloudApiError';
    this.status = status;
    this.errorCode = errorCode;
  }
}

export function parseUpCloudError(data: unknown, status: number): UpCloudApiError {
  const envelope = data as UpCloudErrorEnvelope;
  const error = envelope?.error;
  const message = error?.error_message || error?.error_code || `Request failed (${status})`;
  return new UpCloudApiError(message, status, error?.error_code);
}

// Account types
export interface Account {
  credits?: string;
  payment_method?: string;
  [key: string]: unknown;
}

export interface Zone {
  id: string;
  description?: string;
  public?: string;
  [key: string]: unknown;
}

export interface Plan {
  name: string;
  core_number?: number;
  memory_amount?: number;
  storage_size?: number;
  [key: string]: unknown;
}

// Server types
export interface Server {
  uuid: string;
  title?: string;
  hostname?: string;
  state?: string;
  zone?: string;
  plan?: string;
  core_number?: number;
  memory_amount?: number;
  [key: string]: unknown;
}

export interface ServerCreateParams {
  hostname: string;
  zone: string;
  title?: string;
  plan?: string;
  core_number?: number;
  memory_amount?: number;
  firewall?: 'on' | 'off';
  metadata?: 'yes' | 'no';
  user_data?: string;
  [key: string]: unknown;
}

export interface ServerModifyParams {
  hostname?: string;
  title?: string;
  plan?: string;
  core_number?: number;
  memory_amount?: number;
  firewall?: 'on' | 'off';
  metadata?: 'yes' | 'no';
}

// Storage types
export interface Storage {
  uuid: string;
  title?: string;
  size?: number;
  tier?: string;
  zone?: string;
  state?: string;
  [key: string]: unknown;
}

export interface StorageCreateParams {
  size: number;
  title: string;
  zone: string;
  tier?: 'hdd' | 'maxiops' | 'standard' | 'archive';
  encrypted?: 'yes' | 'no';
}

export interface StorageModifyParams {
  size?: number;
  title?: string;
}

// Network types
export interface IpAddress {
  address?: string;
  family?: string;
  server?: string;
  access?: string;
  [key: string]: unknown;
}

export interface FirewallRule {
  position?: number;
  direction?: string;
  action?: string;
  [key: string]: unknown;
}

export interface Network {
  uuid: string;
  name?: string;
  zone?: string;
  [key: string]: unknown;
}

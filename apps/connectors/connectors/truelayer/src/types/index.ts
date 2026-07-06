// TrueLayer API Types

export interface TrueLayerConfig {
  accessToken: string;
  sandbox?: boolean;
  baseUrl?: string;
}

export interface TrueLayerPayment {
  id: string;
  status?: string;
  amount_in_minor?: number;
  currency?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface TrueLayerEvent {
  type?: string;
  event_id?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface TrueLayerSearchRequest {
  query?: string;
  [key: string]: unknown;
}

export interface TrueLayerListResponse<T> {
  results?: T[];
  [key: string]: unknown;
}

export interface PaymentListParams {
  cursor?: string;
  limit?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface EventListParams {
  cursor?: string;
  limit?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface CreatePaymentRequest {
  amount_in_minor?: number;
  currency?: string;
  beneficiary?: Record<string, unknown>;
  [key: string]: unknown;
}

export class TrueLayerApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly traceId?: string;

  constructor(message: string, statusCode: number, code?: string, traceId?: string) {
    super(message);
    this.name = 'TrueLayerApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.traceId = traceId;
  }
}

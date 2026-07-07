// Userlist Push API Types
// Docs: https://userlist.com/docs/developers/push-api/

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type CustomProperties = Record<string, JsonValue>;

export type ResourceRef = string | number | EmbeddedUser | EmbeddedCompany;

export interface SubscriptionPreference {
  topic: string;
  subscribed: boolean;
}

export interface RelationshipPayload {
  company?: ResourceRef;
  user?: ResourceRef;
  properties?: CustomProperties;
}

export interface UserIdentifyPayload {
  identifier?: string | number;
  email?: string;
  signed_up_at?: string;
  properties?: CustomProperties;
  relationships?: RelationshipPayload[];
  company?: ResourceRef;
  companies?: ResourceRef[];
  preferences?: SubscriptionPreference[];
}

export interface UserDeletePayload {
  identifier?: string | number;
  email?: string;
}

export interface CompanyIdentifyPayload {
  identifier: string | number;
  name?: string;
  signed_up_at?: string;
  properties?: CustomProperties;
  relationships?: RelationshipPayload[];
  user?: ResourceRef;
  users?: ResourceRef[];
}

export interface CompanyDeletePayload {
  identifier: string | number;
}

export interface RelationshipUpsertPayload {
  user: ResourceRef;
  company: ResourceRef;
  properties?: CustomProperties;
}

export interface RelationshipDeletePayload {
  user: ResourceRef;
  company: ResourceRef;
}

export interface EventTrackPayload {
  name: string;
  user?: ResourceRef;
  company?: ResourceRef;
  occurred_at?: string;
  properties?: CustomProperties;
}

export interface MessageBodyContent {
  type: 'html' | 'text' | 'multipart';
  content: string | Array<{ type: string; content: string }>;
}

export interface MessageSendPayload {
  template?: string;
  user?: ResourceRef;
  company?: ResourceRef;
  properties?: CustomProperties;
  channel?: 'email' | 'web';
  to?: string;
  from?: string;
  reply_to?: string;
  subject?: string;
  preheader?: string;
  body?: MessageBodyContent;
  sender?: string;
  theme?: string | boolean;
  topic?: string;
}

export interface EmbeddedUser {
  identifier?: string | number;
  email?: string;
  signed_up_at?: string;
  properties?: CustomProperties;
}

export interface EmbeddedCompany {
  identifier: string | number;
  name?: string;
  signed_up_at?: string;
  properties?: CustomProperties;
}

export interface PushApiErrorBody {
  status?: number;
  code?: string;
  errors?: string[];
}

export interface ApiErrorDetail {
  code: string;
  message: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];
  public readonly documentationUrl?: string;

  constructor(
    message: string,
    statusCode: number,
    options?: {
      errors?: ApiErrorDetail[];
      documentationUrl?: string;
    }
  ) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
    this.documentationUrl = options?.documentationUrl;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 401:
        return 'Authentication failed. Check your Push API key.';
      case 403:
        return 'Access denied. This feature may not be included in your plan.';
      case 413:
        return 'Payload too large. Userlist limits requests to 100KB.';
      case 422:
        return 'Validation error. Check your payload.';
      case 429:
        return 'Rate limit exceeded (1000 requests/minute). Try again later.';
      default:
        return this.message;
    }
  }
}

export function parseApiError(response: unknown, statusCode: number): ConnectorApiError {
  const docs = 'https://userlist.com/docs/developers/push-api/';

  if (typeof response === 'string') {
    return new ConnectorApiError(response || `HTTP ${statusCode} Error`, statusCode, {
      documentationUrl: docs,
    });
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode, { documentationUrl: docs });
  }

  const data = response as PushApiErrorBody & Record<string, unknown>;
  const message =
    (Array.isArray(data.errors) ? data.errors.join('; ') : undefined) ||
    (data.code as string) ||
    (data.message as string) ||
    `HTTP ${statusCode} Error`;

  let errors: ApiErrorDetail[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e) => ({
      code: data.code || 'error',
      message: String(e),
    }));
  }

  return new ConnectorApiError(message, statusCode, {
    errors,
    documentationUrl: docs,
  });
}

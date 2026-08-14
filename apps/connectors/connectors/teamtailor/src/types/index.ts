// Teamtailor API Types
//
// The Teamtailor Public API (https://api.teamtailor.com/v1) follows the
// JSON:API specification (https://jsonapi.org/). Every resource is returned as
// a { data, included?, meta?, links? } envelope where each resource object has
// an `id`, `type`, `attributes` and optional `relationships`.

// ============================================
// Configuration
// ============================================

export interface TeamtailorConfig {
  /** Teamtailor API key (sent as `Authorization: Token token=<apiKey>`). */
  apiKey: string;
  /** Required X-Api-Version date header (format YYYYMMDD). */
  apiVersion?: string;
  /** Override the API base URL (defaults to https://api.teamtailor.com/v1). */
  baseUrl?: string;
}

export interface CliConfig {
  apiKey?: string;
  apiVersion?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'table' | 'pretty';

// ============================================
// JSON:API Envelope Types
// ============================================

export interface JsonApiRelationshipRef {
  type: string;
  id: string;
}

export interface JsonApiRelationship {
  data?: JsonApiRelationshipRef | JsonApiRelationshipRef[] | null;
  links?: Record<string, string>;
  meta?: Record<string, unknown>;
}

export interface JsonApiResourceObject<A = Record<string, unknown>> {
  id: string;
  type: string;
  attributes: A;
  relationships?: Record<string, JsonApiRelationship>;
  links?: Record<string, string>;
  meta?: Record<string, unknown>;
}

export interface JsonApiMeta {
  'record-count'?: number;
  'page-count'?: number;
  [key: string]: unknown;
}

export interface JsonApiLinks {
  self?: string;
  first?: string;
  prev?: string;
  next?: string;
  last?: string;
  [key: string]: string | undefined;
}

export interface JsonApiListResponse<A = Record<string, unknown>> {
  data: JsonApiResourceObject<A>[];
  included?: JsonApiResourceObject[];
  meta?: JsonApiMeta;
  links?: JsonApiLinks;
}

export interface JsonApiSingleResponse<A = Record<string, unknown>> {
  data: JsonApiResourceObject<A>;
  included?: JsonApiResourceObject[];
  meta?: JsonApiMeta;
  links?: JsonApiLinks;
}

/** Body shape for create/update requests. */
export interface JsonApiWriteBody {
  data: {
    type: string;
    id?: string;
    attributes?: Record<string, unknown>;
    relationships?: Record<string, JsonApiRelationship>;
  };
}

// ============================================
// Common list parameters
// ============================================

export interface ListParams {
  /** Page number (JSON:API page[number]). */
  pageNumber?: number;
  /** Page size (JSON:API page[size], max 30 on most Teamtailor resources). */
  pageSize?: number;
  /** Comma-separated relationship paths to sideload (JSON:API include). */
  include?: string;
  /** Sort field(s), e.g. `-created-at`. */
  sort?: string;
  /** JSON:API sparse filters, mapped to filter[key]=value. */
  filter?: Record<string, string | number | boolean>;
}

// ============================================
// Attribute helper types for known resources
// ============================================

export interface CandidateAttributes {
  'first-name'?: string;
  'last-name'?: string;
  email?: string;
  phone?: string;
  pitch?: string;
  sourced?: boolean;
  'created-at'?: string;
  'updated-at'?: string;
  [key: string]: unknown;
}

export interface JobAttributes {
  title?: string;
  status?: string;
  'created-at'?: string;
  'updated-at'?: string;
  pitch?: string;
  'human-status'?: string;
  [key: string]: unknown;
}

export interface JobApplicationAttributes {
  'created-at'?: string;
  'updated-at'?: string;
  'sourced'?: boolean;
  [key: string]: unknown;
}

export interface UserAttributes {
  name?: string;
  email?: string;
  role?: string;
  title?: string;
  [key: string]: unknown;
}

// ============================================
// API Error Types
// ============================================

export interface TeamtailorErrorField {
  status?: string;
  code?: string;
  title?: string;
  detail?: string;
  source?: Record<string, unknown>;
}

export class TeamtailorApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody?: string;
  public readonly errors?: TeamtailorErrorField[];

  constructor(
    message: string,
    statusCode: number,
    options?: {
      responseBody?: string;
      errors?: TeamtailorErrorField[];
    }
  ) {
    super(message);
    this.name = 'TeamtailorApiError';
    this.statusCode = statusCode;
    this.responseBody = options?.responseBody;
    this.errors = options?.errors;
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

  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 401:
        return 'Authentication failed. Check your TEAMTAILOR_API_KEY.';
      case 403:
        return 'Access denied. Your API key may not have permission for this action.';
      case 404:
        return 'Resource not found.';
      case 406:
        return 'Missing or invalid X-Api-Version header.';
      case 422:
        return 'Validation error. Check your input parameters.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      default:
        return this.message;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      errors: this.errors,
      responseBody: this.responseBody,
    };
  }
}

/**
 * Parse a Teamtailor JSON:API error response into a TeamtailorApiError.
 * JSON:API errors are returned as `{ errors: [{ title, detail, code, ... }] }`.
 */
export function parseApiError(
  response: unknown,
  statusCode: number
): TeamtailorApiError {
  if (typeof response === 'string') {
    return new TeamtailorApiError(response || `HTTP ${statusCode} Error`, statusCode, {
      responseBody: response,
    });
  }

  if (!response || typeof response !== 'object') {
    return new TeamtailorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;

  let errors: TeamtailorErrorField[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e: Record<string, unknown>) => ({
      status: e.status as string | undefined,
      code: e.code as string | undefined,
      title: e.title as string | undefined,
      detail: e.detail as string | undefined,
      source: e.source as Record<string, unknown> | undefined,
    }));
  }

  const message =
    errors?.map(e => e.detail || e.title).filter(Boolean).join('; ') ||
    (data.message as string) ||
    (data.error as string) ||
    `HTTP ${statusCode} Error`;

  return new TeamtailorApiError(message, statusCode, {
    responseBody: JSON.stringify(data),
    errors,
  });
}

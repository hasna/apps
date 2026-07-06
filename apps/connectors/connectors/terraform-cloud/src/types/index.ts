// Terraform Cloud Connector Types

export interface TerraformCloudConfig {
  apiToken: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty' | 'table';

// ============================================
// JSON:API Types
// ============================================

export interface JsonApiResource<T extends string = string, A = Record<string, unknown>> {
  id?: string;
  type: T;
  attributes?: A;
  relationships?: Record<string, JsonApiRelationship>;
  links?: Record<string, string>;
}

export interface JsonApiRelationship {
  data?: JsonApiResourceIdentifier | JsonApiResourceIdentifier[] | null;
  links?: Record<string, string>;
}

export interface JsonApiResourceIdentifier {
  id: string;
  type: string;
}

export interface JsonApiDocument<T extends string = string, A = Record<string, unknown>> {
  data: JsonApiResource<T, A> | JsonApiResource<T, A>[] | null;
  included?: JsonApiResource[];
  meta?: Record<string, unknown>;
  links?: Record<string, string>;
}

export interface JsonApiError {
  status?: string;
  title?: string;
  detail?: string;
  code?: string;
}

export interface JsonApiErrorDocument {
  errors: JsonApiError[];
}

// ============================================
// Domain Types
// ============================================

export interface OrganizationAttributes {
  name: string;
  'external-id'?: string;
  'created-at'?: string;
  email?: string;
  'session-remember'?: number;
  'collaborator-auth-policy'?: string;
  'plan-expired'?: boolean;
  'plan-expires-at'?: string | null;
  'plan-is-trial'?: boolean;
  'plan-is-enterprise'?: boolean;
}

export interface WorkspaceAttributes {
  name: string;
  description?: string;
  'terraform-version'?: string;
  'working-directory'?: string;
  'execution-mode'?: string;
  'auto-apply'?: boolean;
  'locked'?: boolean;
  'resource-count'?: number;
  'updated-at'?: string;
  'created-at'?: string;
}

export interface RunAttributes {
  message?: string;
  status?: string;
  'is-destroy'?: boolean;
  'auto-apply'?: boolean;
  'created-at'?: string;
}

export interface VariableAttributes {
  key: string;
  value?: string;
  description?: string;
  category?: 'terraform' | 'env';
  hcl?: boolean;
  sensitive?: boolean;
}

export interface StateVersionAttributes {
  'hosted-state-download-url'?: string;
  'hosted-json-state-download-url'?: string;
  status?: string;
  'created-at'?: string;
}

export interface ConfigurationVersionAttributes {
  status?: string;
  'auto-queue-runs'?: boolean;
  speculative?: boolean;
  source?: string;
}

export interface TeamAttributes {
  name: string;
  'visibility'?: string;
  'permission-project'?: string;
  'permission-workspace'?: string;
}

export interface ProjectAttributes {
  name: string;
  description?: string;
}

export interface PolicySetAttributes {
  name: string;
  description?: string;
  'global'?: boolean;
  policies_path?: string;
}

export class TerraformCloudApiError extends Error {
  readonly statusCode: number;
  readonly errors: JsonApiError[];

  constructor(message: string, statusCode: number, errors: JsonApiError[] = []) {
    super(message);
    this.name = 'TerraformCloudApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }
}

export function parseApiError(data: unknown, statusCode: number): TerraformCloudApiError {
  if (typeof data === 'object' && data !== null && 'errors' in data) {
    const doc = data as JsonApiErrorDocument;
    const errors = doc.errors || [];
    const message = errors.map((e) => e.detail || e.title || e.status).filter(Boolean).join('; ')
      || `Request failed with status ${statusCode}`;
    return new TerraformCloudApiError(message, statusCode, errors);
  }

  if (typeof data === 'object' && data !== null && 'error' in data) {
    const err = (data as { error?: string }).error;
    return new TerraformCloudApiError(err || `Request failed with status ${statusCode}`, statusCode);
  }

  return new TerraformCloudApiError(`Request failed with status ${statusCode}`, statusCode);
}

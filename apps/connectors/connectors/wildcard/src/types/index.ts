// Wildcard API Types

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface WildcardConfig {
  apiKey: string;
  baseUrl?: string;
  defaultCollectionId?: string;
  providerAuthJson?: Record<string, ProviderAuthConfig>;
}

export interface ProviderAuthConfig {
  type?: 'bearer' | 'apiKey' | 'basic' | 'none';
  token?: string;
  key_value?: string;
  key_name?: string;
  key_prefix?: string;
  in?: 'header' | 'query';
  credentials?: string | { username?: string; password?: string; base64_encode?: boolean };
}

export interface AgentsJsonDocument {
  agentsJson?: string;
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  sources?: Array<{
    id: string;
    path: string;
  }>;
  flows?: FlowDefinition[];
}

export interface FlowDefinition {
  id: string;
  title?: string;
  description?: string;
  actions?: Array<{
    id: string;
    sourceId: string;
    operationId: string;
  }>;
  links?: Array<{
    origin: {
      actionId: string | null;
      fieldPath: string;
    };
    target: {
      actionId: string | null;
      fieldPath: string;
    };
  }>;
  fields?: {
    parameters?: Array<{
      name: string;
      type?: string;
      description?: string;
      required?: boolean;
    }>;
    requestBody?: {
      content?: Record<string, { schema?: unknown; schema_?: unknown }>;
      required?: boolean;
    };
    responses?: Record<string, unknown>;
  };
}

export interface OpenApiDocument {
  openapi?: string;
  swagger?: string;
  servers?: Array<{ url?: string }>;
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

export interface OpenApiOperation {
  operationId?: string;
  parameters?: Array<{
    name: string;
    in?: 'query' | 'header' | 'path' | 'cookie';
    required?: boolean;
  }>;
  requestBody?: unknown;
}

export interface FlowInvokeResult {
  flowId: string;
  info?: AgentsJsonDocument['info'];
  actions: Array<{
    actionId: string;
    sourceId: string;
    operationId: string;
    request: { method: string; url: string };
    status: number;
    response: Record<string, unknown>;
  }>;
  result: Record<string, unknown>;
}

export class WildcardApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'WildcardApiError';
  }
}

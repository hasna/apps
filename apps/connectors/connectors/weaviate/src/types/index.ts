export interface WeaviateConfig {
  host: string;
  apiKey?: string;
}

export interface WeaviateClassProperty {
  name: string;
  dataType: string[];
  description?: string;
}

export interface WeaviateClass {
  class: string;
  description?: string;
  properties?: WeaviateClassProperty[];
}

export interface WeaviateSchema {
  classes?: WeaviateClass[];
}

export interface WeaviateObject {
  id?: string;
  class: string;
  properties?: Record<string, unknown>;
  vector?: number[];
  creationTimeUnix?: number;
  lastUpdateTimeUnix?: number;
}

export interface WeaviateGraphQLRequest {
  query: string;
  variables?: Record<string, unknown>;
}

export interface WeaviateGraphQLResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string }>;
}

export interface WeaviateNodeInfo {
  nodes?: Array<Record<string, unknown>>;
}

export class WeaviateApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WeaviateApiError';
    this.statusCode = statusCode;
  }
}

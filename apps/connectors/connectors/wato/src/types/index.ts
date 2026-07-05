export interface WatoConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface WatoMemory {
  id: string;
  title?: string;
  content?: string;
  scope?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface WatoMemoryList {
  memories?: WatoMemory[];
  items?: WatoMemory[];
  total?: number;
  [key: string]: unknown;
}

export interface WatoWorkflow {
  id: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
}

export interface WatoWorkflowList {
  workflows?: WatoWorkflow[];
  items?: WatoWorkflow[];
  total?: number;
  [key: string]: unknown;
}

export interface WatoWorkflowRun {
  id: string;
  workflow_id?: string;
  status?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  [key: string]: unknown;
}

export interface WatoTool {
  id: string;
  name?: string;
  description?: string;
  connected?: boolean;
  [key: string]: unknown;
}

export interface WatoToolList {
  tools?: WatoTool[];
  items?: WatoTool[];
  total?: number;
  [key: string]: unknown;
}

export interface WatoArtifact {
  id: string;
  type?: string;
  content?: unknown;
  [key: string]: unknown;
}

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export class WatoApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WatoApiError';
    this.statusCode = statusCode;
  }
}

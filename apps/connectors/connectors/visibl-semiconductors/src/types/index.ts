// Visibl Semiconductors Connector Types

export interface VisiblSemiconductorsConfig {
  apiKey: string;
  baseUrl?: string;
}

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface Project {
  id: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
}

export interface DriftCase {
  id: string;
  projectId?: string;
  severity?: string;
  status?: string;
  [key: string]: unknown;
}

export interface FixProposal {
  id: string;
  caseId?: string;
  status?: string;
  [key: string]: unknown;
}

export interface CiSignal {
  id: string;
  projectId?: string;
  failing?: boolean;
  [key: string]: unknown;
}

export interface TapeoutReadiness {
  projectId: string;
  ready?: boolean;
  blockers?: string[];
  [key: string]: unknown;
}

export interface RawRequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  query?: QueryParams;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export class VisiblSemiconductorsApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'VisiblSemiconductorsApiError';
  }
}

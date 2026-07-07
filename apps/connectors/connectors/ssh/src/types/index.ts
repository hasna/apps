export interface SshConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface SshSession {
  id: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface SshSessionList {
  sessions?: SshSession[];
  data?: SshSession[];
  total?: number;
  [key: string]: unknown;
}

export interface SshEvent {
  id: string;
  type?: string;
  timestamp?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface SshEventList {
  events?: SshEvent[];
  data?: SshEvent[];
  total?: number;
  [key: string]: unknown;
}

export interface SshSearchRequest {
  query?: string;
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SshSearchResponse {
  results?: unknown[];
  total?: number;
  [key: string]: unknown;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export class SshApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'SshApiError';
    this.statusCode = statusCode;
  }
}

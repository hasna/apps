// Unisson Runner API types

export interface UnissonConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty' | 'table';

export interface UnissonAgent {
  id: string;
  product?: string;
  channel?: string;
  [key: string]: unknown;
}

export interface UnissonTask {
  id: string;
  agentId?: string;
  title?: string;
  [key: string]: unknown;
}

export interface UnissonKnowledgeArticle {
  id: string;
  title?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ListResponse<T> {
  data?: T[];
  items?: T[];
  [key: string]: unknown;
}

export class UnissonApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'UnissonApiError';
    this.statusCode = statusCode;
  }
}

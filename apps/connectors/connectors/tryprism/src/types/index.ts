export interface TryPrismConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface TryPrismSearch {
  id: string;
  title?: string;
  location?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface TryPrismCandidate {
  id: string;
  name?: string;
  email?: string;
  search_id?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface TryPrismShortlist {
  id: string;
  name?: string;
  search_id?: string;
  candidate_ids?: string[];
  created_at?: string;
  [key: string]: unknown;
}

export interface TryPrismListResponse<T> {
  data?: T[];
  items?: T[];
  total?: number;
  [key: string]: unknown;
}

export class TryPrismApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TryPrismApiError';
    this.statusCode = statusCode;
  }
}

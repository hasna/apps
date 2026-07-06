export interface YouArtConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface YouArtProject {
  id: string;
  title?: string;
  genre?: string;
  status?: string;
  [key: string]: unknown;
}

export interface YouArtOriginal {
  id: string;
  project_id?: string;
  visibility?: string;
  [key: string]: unknown;
}

export interface YouArtMembershipTier {
  id: string;
  project_id?: string;
  [key: string]: unknown;
}

export interface YouArtFundingCampaign {
  id: string;
  project_id?: string;
  goal_cents?: number;
  [key: string]: unknown;
}

export interface YouArtBacker {
  id: string;
  campaign_id?: string;
  [key: string]: unknown;
}

export interface YouArtRawRequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export class YouArtApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'YouArtApiError';
    this.statusCode = statusCode;
  }
}

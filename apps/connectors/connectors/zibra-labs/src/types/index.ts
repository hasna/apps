// Zibra Labs API Types

export interface ZibraLabsConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface Cluster {
  id: string;
  name?: string;
  region?: string;
  status?: string;
  [key: string]: unknown;
}

export interface BacktestJob {
  id: string;
  status?: string;
  clusterId?: string;
  strategyRef?: string;
  datasetId?: string;
  createdAt?: string;
  completedAt?: string;
  [key: string]: unknown;
}

export interface Dataset {
  id: string;
  name?: string;
  assetClass?: string;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class ZibraLabsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = 'ZibraLabsApiError';
  }
}

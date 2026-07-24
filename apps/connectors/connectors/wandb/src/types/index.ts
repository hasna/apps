// Weights & Biases GraphQL API types

export type OutputFormat = 'json' | 'table' | 'pretty';

export interface WandbConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface ProfileConfig {
  apiKey?: string;
  baseUrl?: string;
}

export class WandbApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'WandbApiError';
  }
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
}

export interface WandbViewer {
  id: string;
  username: string;
  name?: string;
  email?: string;
  entity?: string;
}

export interface ViewerResponse {
  viewer: WandbViewer;
}

export interface WandbRun {
  id: string;
  name: string;
  displayName?: string;
  state?: string;
  createdAt?: string;
  summaryMetrics?: Record<string, unknown>;
}

export interface ProjectRunsResponse {
  project: {
    runs: {
      edges: Array<{ node: WandbRun }>;
      pageInfo?: {
        endCursor?: string;
        hasNextPage?: boolean;
      };
    };
  } | null;
}

export interface ProjectRunsOptions {
  entity: string;
  project: string;
  first?: number;
  order?: string;
  filters?: Record<string, unknown>;
}

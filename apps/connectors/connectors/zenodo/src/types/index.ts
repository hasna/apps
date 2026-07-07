export type OutputFormat = 'json' | 'pretty' | 'table';

export interface ZenodoCreator {
  name: string;
  affiliation?: string;
  orcid?: string;
}

export interface ZenodoMetadata {
  title?: string;
  upload_type?: string;
  publication_type?: string;
  description?: string;
  creators?: ZenodoCreator[];
  keywords?: string[];
  license?: string;
  access_right?: string;
  [key: string]: unknown;
}

export interface ZenodoRecord {
  id: number | string;
  conceptrecid?: string;
  doi?: string;
  metadata?: ZenodoMetadata;
  links?: Record<string, string>;
  created?: string;
  modified?: string;
  [key: string]: unknown;
}

export interface ZenodoDeposition {
  id: number;
  conceptrecid?: string;
  record_id?: number;
  state?: string;
  submitted?: boolean;
  metadata?: ZenodoMetadata;
  links?: Record<string, string>;
  created?: string;
  modified?: string;
  files?: unknown[];
  [key: string]: unknown;
}

export interface RecordsSearchOptions {
  q?: string;
  type?: string;
  subtype?: string;
  sort?: string;
  page?: number;
  size?: number;
  status?: 'draft' | 'published';
  communities?: string;
}

export interface RecordsSearchResult {
  hits: ZenodoRecord[];
  total: number;
}

export interface ConnectorConfig {
  accessToken?: string;
  baseUrl?: string;
}

export interface CreateDepositionOptions {
  metadata?: ZenodoMetadata;
}

export interface UpdateDepositionOptions {
  metadata: ZenodoMetadata;
}

export class ZenodoApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ZenodoApiError';
  }
}

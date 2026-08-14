import type { HuggingFaceClient } from './client';

export interface DatasetSearchOptions {
  search?: string;
  author?: string;
  filter?: string;
  sort?: 'likes' | 'downloads' | 'trending' | 'lastModified';
  direction?: 'asc' | 'desc';
  limit?: number;
  full?: boolean;
}

export interface DatasetInfo {
  _id: string;
  id: string;
  author?: string;
  sha?: string;
  lastModified?: string;
  private?: boolean;
  gated?: boolean | string;
  tags?: string[];
  downloads?: number;
  likes?: number;
  description?: string;
  citation?: string;
  cardData?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DatasetSplit {
  dataset: string;
  config: string;
  split: string;
  num_rows: number;
  num_bytes: number;
}

export class DatasetsApi {
  constructor(private readonly client: HuggingFaceClient) {}

  /** Search/list datasets */
  async search(options: DatasetSearchOptions = {}): Promise<DatasetInfo[]> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (options.search) params.search = options.search;
    if (options.author) params.author = options.author;
    if (options.filter) params.filter = options.filter;
    if (options.sort) params.sort = options.sort;
    if (options.direction) params.direction = options.direction === 'desc' ? '-1' : '1';
    if (options.limit) params.limit = options.limit;
    if (options.full) params.full = true;

    return this.client.request<DatasetInfo[]>('/datasets', { params });
  }

  /** Get a single dataset by ID */
  async get(datasetId: string): Promise<DatasetInfo> {
    return this.client.request<DatasetInfo>(`/datasets/${datasetId}`);
  }

  /** Preview first N rows of a dataset split */
  async preview(datasetId: string, config = 'default', split = 'train', rows = 10): Promise<unknown> {
    // Uses the datasets-server API
    const url = `https://datasets-server.huggingface.co/first-rows?dataset=${encodeURIComponent(datasetId)}&config=${config}&split=${split}&rows=${rows}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.client.getApiKey()}` },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Dataset preview failed (${response.status}): ${text}`);
    }
    return response.json();
  }
}

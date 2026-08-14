import type { HuggingFaceClient } from './client';

export interface ModelSearchOptions {
  search?: string;
  author?: string;
  filter?: string;       // task filter: text-generation, text2text-generation, etc
  library?: string;      // transformers, gguf, pytorch, etc
  sort?: 'likes' | 'downloads' | 'trending' | 'lastModified';
  direction?: 'asc' | 'desc';
  limit?: number;
  full?: boolean;        // include all fields
}

export interface ModelInfo {
  _id: string;
  id: string;            // e.g. "meta-llama/Meta-Llama-3-8B"
  modelId: string;
  author?: string;
  sha?: string;
  lastModified?: string;
  private?: boolean;
  disabled?: boolean;
  gated?: boolean | string;
  pipeline_tag?: string;
  tags?: string[];
  downloads?: number;
  likes?: number;
  library_name?: string;
  [key: string]: unknown;
}

export interface ModelFile {
  rfilename: string;
  size?: number;
  blobId?: string;
  lfs?: { size: number; sha256: string; pointerSize: number };
}

export class ModelsApi {
  constructor(private readonly client: HuggingFaceClient) {}

  /** Search/list models */
  async search(options: ModelSearchOptions = {}): Promise<ModelInfo[]> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (options.search) params.search = options.search;
    if (options.author) params.author = options.author;
    if (options.filter) params.filter = options.filter;
    if (options.library) params.library = options.library;
    if (options.sort) params.sort = options.sort;
    if (options.direction) params.direction = options.direction === 'desc' ? '-1' : '1';
    if (options.limit) params.limit = options.limit;
    if (options.full) params.full = true;

    return this.client.request<ModelInfo[]>('/models', { params });
  }

  /** Get a single model by ID (e.g. "meta-llama/Meta-Llama-3-8B") */
  async get(modelId: string): Promise<ModelInfo> {
    return this.client.request<ModelInfo>(`/models/${modelId}`);
  }

  /** List files in a model repo */
  async files(modelId: string): Promise<ModelFile[]> {
    return this.client.request<ModelFile[]>(`/models/${modelId}/tree/main`);
  }
}

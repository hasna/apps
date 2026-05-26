import type { HuggingFaceClient } from './client';

export interface SpaceSearchOptions {
  search?: string;
  author?: string;
  sort?: 'likes' | 'trending' | 'lastModified';
  direction?: 'asc' | 'desc';
  limit?: number;
}

export interface SpaceInfo {
  _id: string;
  id: string;
  author?: string;
  sha?: string;
  lastModified?: string;
  private?: boolean;
  tags?: string[];
  likes?: number;
  sdk?: string;
  runtime?: { stage: string; hardware?: { current?: string } };
  [key: string]: unknown;
}

export class SpacesApi {
  constructor(private readonly client: HuggingFaceClient) {}

  async search(options: SpaceSearchOptions = {}): Promise<SpaceInfo[]> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (options.search) params.search = options.search;
    if (options.author) params.author = options.author;
    if (options.sort) params.sort = options.sort;
    if (options.direction) params.direction = options.direction === 'desc' ? '-1' : '1';
    if (options.limit) params.limit = options.limit;

    return this.client.request<SpaceInfo[]>('/spaces', { params });
  }

  async get(spaceId: string): Promise<SpaceInfo> {
    return this.client.request<SpaceInfo>(`/spaces/${spaceId}`);
  }
}

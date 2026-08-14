import type {
  CreateItemInput,
  CreateItemsResponse,
  ListItemsOptions,
  UpdateItemInput,
  ZoteroItem,
} from '../types';
import { encodePathSegment, ZoteroClient } from './client';

export class ItemsApi {
  constructor(private readonly client: ZoteroClient) {}

  private itemsPath(collectionKey?: string): string {
    const prefix = this.client.libraryPrefix();
    if (collectionKey) {
      return `${prefix}/collections/${encodePathSegment(collectionKey)}/items`;
    }
    return `${prefix}/items`;
  }

  async list(options: ListItemsOptions = {}): Promise<ZoteroItem[]> {
    const { collectionKey, ...params } = options;
    return this.client.get<ZoteroItem[]>(this.itemsPath(collectionKey), params);
  }

  async search(query: string, options: Omit<ListItemsOptions, 'q'> = {}): Promise<ZoteroItem[]> {
    return this.list({ ...options, q: query });
  }

  async get(itemKey: string): Promise<ZoteroItem> {
    const prefix = this.client.libraryPrefix();
    return this.client.get<ZoteroItem>(`${prefix}/items/${encodePathSegment(itemKey)}`);
  }

  async create(items: CreateItemInput | CreateItemInput[]): Promise<CreateItemsResponse> {
    const payload = Array.isArray(items) ? items : [items];
    return this.client.post<CreateItemsResponse>(this.itemsPath(), payload);
  }

  async update(
    itemKey: string,
    item: UpdateItemInput,
    version?: number | string,
    method: 'PATCH' | 'PUT' = 'PATCH'
  ): Promise<CreateItemsResponse> {
    const prefix = this.client.libraryPrefix();
    const path = `${prefix}/items/${encodePathSegment(itemKey)}`;

    if (method === 'PUT') {
      return this.client.request<CreateItemsResponse>(path, {
        method: 'PUT',
        body: item,
        version,
      });
    }

    return this.client.patch<CreateItemsResponse>(path, item, { version });
  }

  async delete(itemKey: string, version: number | string): Promise<void> {
    const prefix = this.client.libraryPrefix();
    await this.client.delete(`${prefix}/items/${encodePathSegment(itemKey)}`, { version });
  }
}

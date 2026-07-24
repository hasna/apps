import type { ZoteroConfig, RequestOptions } from '../types';
import { ZoteroClient } from './client';
import { ItemsApi } from './items';
import { CollectionsApi } from './collections';
import { AttachmentsApi } from './attachments';

export {
  ZoteroClient,
  DEFAULT_BASE_URL,
  ZOTERO_API_VERSION,
  normalizeLibraryType,
  buildLibraryPrefix,
  buildZoteroUrl,
} from './client';
export { ItemsApi } from './items';
export { CollectionsApi } from './collections';
export { AttachmentsApi } from './attachments';

export class Zotero {
  private readonly client: ZoteroClient;

  public readonly items: ItemsApi;
  public readonly collections: CollectionsApi;
  public readonly attachments: AttachmentsApi;

  constructor(config: ZoteroConfig) {
    this.client = new ZoteroClient(config);
    this.items = new ItemsApi(this.client);
    this.collections = new CollectionsApi(this.client);
    this.attachments = new AttachmentsApi(this.client);
  }

  async test(): Promise<unknown[]> {
    const prefix = this.client.libraryPrefix();
    return this.client.get(`${prefix}/items`, { limit: 1 });
  }

  async rawRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.client.request<T>(path, options);
  }

  getClient(): ZoteroClient {
    return this.client;
  }
}

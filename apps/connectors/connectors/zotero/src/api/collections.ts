import type { CreateCollectionInput, ZoteroCollection } from '../types';
import { encodePathSegment, ZoteroClient } from './client';

export class CollectionsApi {
  constructor(private readonly client: ZoteroClient) {}

  private collectionsPath(): string {
    return `${this.client.libraryPrefix()}/collections`;
  }

  async list(): Promise<ZoteroCollection[]> {
    return this.client.get<ZoteroCollection[]>(this.collectionsPath());
  }

  async get(collectionKey: string): Promise<ZoteroCollection> {
    const prefix = this.client.libraryPrefix();
    return this.client.get<ZoteroCollection>(
      `${prefix}/collections/${encodePathSegment(collectionKey)}`
    );
  }

  async create(collections: CreateCollectionInput | CreateCollectionInput[]): Promise<unknown> {
    const payload = Array.isArray(collections) ? collections : [collections];
    return this.client.post(this.collectionsPath(), payload);
  }
}

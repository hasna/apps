import type { WildcardClient } from './client';
import { optionalString, requireString, withQuery } from '../utils/args';

export class SearchApi {
  constructor(
    private readonly client: WildcardClient,
    private readonly defaultCollectionId?: string,
  ) {}

  async searchTools(args: Record<string, unknown>): Promise<unknown> {
    const collectionId = optionalString(args.collection_id ?? args.collectionId, 'collection_id')
      ?? this.defaultCollectionId;
    return this.client.get(withQuery('/search', {
      query: requireString(args.query ?? args.q, 'query'),
      collection_id: collectionId ?? requireString(collectionId, 'collection_id'),
    }));
  }

  async getFlow(args: Record<string, unknown>): Promise<unknown> {
    const collectionId = optionalString(args.collection_id ?? args.collectionId, 'collection_id')
      ?? this.defaultCollectionId;
    return this.client.get(withQuery('/flow', {
      flow_id: requireString(args.flow_id ?? args.flowId, 'flow_id'),
      collection_id: collectionId ?? requireString(collectionId, 'collection_id'),
    }));
  }
}

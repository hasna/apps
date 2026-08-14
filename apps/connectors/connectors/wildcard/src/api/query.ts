import type { WildcardClient } from './client';
import { optionalNumber, optionalString, prune, queryFromArgs, requireString, withQuery } from '../utils/args';

export class QueryApi {
  constructor(private readonly client: WildcardClient) {}

  async searchEndpoints(args: Record<string, unknown>): Promise<unknown> {
    return this.client.get(withQuery('/query/v4/', prune({
      q: requireString(args.q ?? args.query, 'q'),
      q2: optionalString(args.q2 ?? args.description, 'q2') ?? requireString(args.q ?? args.query, 'q'),
      limit: optionalNumber(args.limit, 'limit') ?? 5,
      search_type: optionalString(args.search_type ?? args.searchType, 'search_type') ?? 'multi',
      vectorize_method: optionalString(args.vectorize_method ?? args.vectorizeMethod, 'vectorize_method') ?? 'jinaai',
      index_name: optionalString(args.index_name ?? args.collection_name ?? args.collectionName, 'index_name'),
      rerank: optionalString(args.rerank, 'rerank') ?? 'False',
      return_vectors: optionalString(args.return_vectors ?? args.returnVectors, 'return_vectors') ?? 'True',
    })));
  }

  async getActionSchema(args: Record<string, unknown>): Promise<unknown> {
    return this.client.get(withQuery('/query/endpoints/', prune({
      id: requireString(args.id ?? args.action_id ?? args.actionId, 'id'),
      collection_name: optionalString(args.collection_name ?? args.collectionName ?? args.index_name, 'collection_name'),
    })));
  }

  async listPublicTools(args: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.get(withQuery('/query/tools', queryFromArgs(args, ['limit', 'offset', 'collection_name', 'index_name'])));
  }

  async getEndpointCount(args: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.get(withQuery('/query/endpoints/size/', queryFromArgs(args, ['collection_name', 'index_name'])));
  }

  async listEndpoints(args: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.get(withQuery('/query/endpoints/all/', queryFromArgs(args, ['collection_name', 'index_name', 'limit', 'offset'])));
  }
}

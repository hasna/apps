import type { UnissonClient } from './client';
import type { ListResponse, UnissonKnowledgeArticle } from '../types';

export class KnowledgeApi {
  constructor(private readonly client: UnissonClient) {}

  listArticles(
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<ListResponse<UnissonKnowledgeArticle>> {
    return this.client.get<ListResponse<UnissonKnowledgeArticle>>('/knowledge/articles', params);
  }

  sync(body: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.post('/knowledge/sync', body);
  }
}

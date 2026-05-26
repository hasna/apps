import type { ConnectorClient } from './client';
import type { KbGroupCreateParams, KbArticleUpdateParams } from '../types';

export class KnowledgeBaseApi {
  constructor(private readonly client: ConnectorClient) {}

  async createGroup(params: KbGroupCreateParams): Promise<unknown> {
    return this.client.post<unknown>('/kb/group/add', params);
  }

  async updateArticle(articleId: number, params: KbArticleUpdateParams): Promise<unknown> {
    return this.client.put<unknown>(`/kb/article/update/${articleId}`, params);
  }
}

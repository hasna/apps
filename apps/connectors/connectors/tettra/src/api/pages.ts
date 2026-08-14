import type { ConnectorClient } from './client';
import type { CreatePageParams, ListPagesParams, Page } from '../types';

export class PagesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListPagesParams): Promise<Page[] | Record<string, unknown>> {
    return this.client.get('/pages', params as Record<string, string | number | boolean | undefined>);
  }

  async get(pageId: string | number): Promise<Page> {
    return this.client.get(`/pages/${encodeURIComponent(String(pageId))}`);
  }

  async create(body: CreatePageParams): Promise<Page> {
    return this.client.post('/pages', body);
  }
}

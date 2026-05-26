import type { ConnectorClient } from './client';
import type { LandingPage, ListParams } from '../types';

export class LandingPagesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(domainId: number, params?: ListParams): Promise<LandingPage[]> {
    return this.client.get<LandingPage[]>(`/domains/${domainId}/landing_pages/`, params as Record<string, string | number | boolean | undefined>);
  }

  async get(domainId: number, pageId: number): Promise<LandingPage> {
    return this.client.get<LandingPage>(`/domains/${domainId}/landing_pages/${pageId}/`);
  }
}

import type { ConnectorClient } from './client';
import type { EmbedAccessTokenResponse, EmbedToken, Filters } from '../types';

export class EmbedsApi {
  constructor(private readonly client: ConnectorClient) {}

  getAccessToken(options?: {
    description?: string;
    duration?: number;
    filters?: Filters;
  }): Promise<EmbedAccessTokenResponse> {
    const params: Record<string, string | number | undefined> = {
      description: options?.description,
      duration: options?.duration,
    };
    if (options?.filters) {
      params.filters = JSON.stringify(options.filters);
    }
    return this.client.get<EmbedAccessTokenResponse>('/v1/workspace/embed-access-token', params);
  }

  listValid(): Promise<EmbedToken[]> {
    return this.client.get<EmbedToken[]>('/v1/workspace/embed-access-tokens/valid');
  }

  revoke(tokenID: string): Promise<void> {
    return this.client.delete<void>(`/v1/workspace/embed-access-tokens/${encodeURIComponent(tokenID)}`);
  }
}

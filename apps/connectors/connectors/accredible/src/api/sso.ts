import type { ConnectorClient } from './client';
import type { SsoLinkParams, SsoLinkResponse } from '../types';

export class SsoApi {
  constructor(private readonly client: ConnectorClient) {}

  async generateLink(params: SsoLinkParams): Promise<SsoLinkResponse> {
    return this.client.post<SsoLinkResponse>('/sso/generate_link', params);
  }
}

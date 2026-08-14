import type { ConnectorClient } from './client';
import type { BrowserUseParams } from '../types';

export class BrowserUseApi {
  constructor(private readonly client: ConnectorClient) {}

  private postWithProduct(path: string, params: BrowserUseParams = {}): Promise<unknown> {
    const { identity_token, model, subdomain, ...rest } = params;
    const body = this.client.withProductBody({
      ...rest,
      ...(identity_token !== undefined ? { identity_token } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(subdomain !== undefined ? { subdomain } : {}),
    });
    return this.client.post(path, body);
  }

  async start(params: BrowserUseParams = {}): Promise<unknown> {
    return this.postWithProduct('/api/browser-use/start', params);
  }

  async step(params: BrowserUseParams = {}): Promise<unknown> {
    return this.postWithProduct('/api/browser-use/step', params);
  }

  async end(params: BrowserUseParams = {}): Promise<unknown> {
    return this.postWithProduct('/api/browser-use/end', params);
  }
}

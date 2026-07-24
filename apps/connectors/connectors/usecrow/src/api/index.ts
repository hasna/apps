import type { ConnectorConfig } from '../types';
import type { RawRequestParams } from '../types';
import { ConnectorClient } from './client';
import { ChatApi } from './chat';
import { WorkflowsApi } from './workflows';
import { BrowserUseApi } from './browser-use';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly chat: ChatApi;
  public readonly workflows: WorkflowsApi;
  public readonly browserUse: BrowserUseApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.chat = new ChatApi(this.client);
    this.workflows = new WorkflowsApi(this.client);
    this.browserUse = new BrowserUseApi(this.client);
  }

  static fromEnv(): Connector {
    const productId = process.env.USECROW_PRODUCT_ID;
    if (!productId) {
      throw new Error('USECROW_PRODUCT_ID environment variable is required');
    }
    return new Connector({
      productId,
      identityToken: process.env.USECROW_IDENTITY_TOKEN,
      baseUrl: process.env.USECROW_BASE_URL,
    });
  }

  async rawRequest(params: RawRequestParams): Promise<unknown> {
    const { path, method = 'GET', query, body, headers } = params;
    return this.client.request(path, { method, params: query, body, headers });
  }

  getProductIdPreview(): string {
    return this.client.getProductIdPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { ChatApi } from './chat';
export { WorkflowsApi } from './workflows';
export { BrowserUseApi } from './browser-use';

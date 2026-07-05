import type { UsereframeConfig, RawRequestOptions } from '../types';
import { UsereframeClient } from './client';
import { BomsApi } from './boms';
import { PartsApi } from './parts';
import { SuppliersApi } from './suppliers';
import { PurchaseOrdersApi } from './purchase-orders';
import { ShipmentsApi } from './shipments';
import { AssistantApi } from './assistant';

export class Usereframe {
  private readonly client: UsereframeClient;

  public readonly boms: BomsApi;
  public readonly parts: PartsApi;
  public readonly suppliers: SuppliersApi;
  public readonly purchaseOrders: PurchaseOrdersApi;
  public readonly shipments: ShipmentsApi;
  public readonly assistant: AssistantApi;

  constructor(config: UsereframeConfig) {
    this.client = new UsereframeClient(config);
    this.boms = new BomsApi(this.client);
    this.parts = new PartsApi(this.client);
    this.suppliers = new SuppliersApi(this.client);
    this.purchaseOrders = new PurchaseOrdersApi(this.client);
    this.shipments = new ShipmentsApi(this.client);
    this.assistant = new AssistantApi(this.client);
  }

  static fromEnv(): Usereframe {
    const apiKey = process.env.USEREFRAME_API_KEY;
    if (!apiKey) {
      throw new Error('USEREFRAME_API_KEY environment variable is required');
    }

    return new Usereframe({
      apiKey,
      baseUrl: process.env.USEREFRAME_BASE_URL,
    });
  }

  rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { path, method = 'GET', query, body, headers } = options;
    return this.client.request(path, { method, params: query, body, headers });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): UsereframeClient {
    return this.client;
  }
}

export { UsereframeClient, encodePathSegment, DEFAULT_BASE_URL } from './client';
export { BomsApi } from './boms';
export { PartsApi } from './parts';
export { SuppliersApi } from './suppliers';
export { PurchaseOrdersApi } from './purchase-orders';
export { ShipmentsApi } from './shipments';
export { AssistantApi } from './assistant';

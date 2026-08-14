import type { UsereframeClient } from './client';

export class PurchaseOrdersApi {
  constructor(private readonly client: UsereframeClient) {}

  create(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/purchase-orders', body);
  }
}

import type { UsereframeClient } from './client';
import { encodePathSegment } from './client';

export class ShipmentsApi {
  constructor(private readonly client: UsereframeClient) {}

  get(shipmentId: string): Promise<unknown> {
    return this.client.get(`/shipments/${encodePathSegment(shipmentId)}`);
  }
}

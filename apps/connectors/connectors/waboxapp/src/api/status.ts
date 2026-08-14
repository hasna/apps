import type { WaboxappClient } from './client';
import type { WaboxappStatusResponse } from '../types';

export class StatusApi {
  constructor(private readonly client: WaboxappClient) {}

  async getStatus(uid?: string): Promise<WaboxappStatusResponse> {
    const accountUid = uid ?? this.client.getUid();
    return this.client.get<WaboxappStatusResponse>(`/status/${encodeURIComponent(accountUid)}`);
  }
}

import type { SnovIoClient } from './client';
import type { Campaign } from '../types';

export class CampaignsApi {
  constructor(private readonly client: SnovIoClient) {}

  /** List all user campaigns (GET /v1/get-user-campaigns) */
  async list(): Promise<Campaign[]> {
    return this.client.getV1<Campaign[]>('/v1/get-user-campaigns');
  }
}

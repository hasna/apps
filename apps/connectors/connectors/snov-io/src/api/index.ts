import type { SnovIoConfig } from '../types';
import { SnovIoClient } from './client';
import { CampaignsApi } from './campaigns';
import { DomainSearchApi } from './domain-search';
import { AccountApi } from './account';

export class SnovIo {
  private readonly client: SnovIoClient;

  public readonly campaigns: CampaignsApi;
  public readonly domainSearch: DomainSearchApi;
  public readonly account: AccountApi;

  constructor(config: SnovIoConfig) {
    this.client = new SnovIoClient(config);
    this.campaigns = new CampaignsApi(this.client);
    this.domainSearch = new DomainSearchApi(this.client);
    this.account = new AccountApi(this.client);
  }

  static fromEnv(): SnovIo {
    const clientId = process.env.SNOV_IO_CLIENT_ID;
    const clientSecret = process.env.SNOV_IO_CLIENT_SECRET;
    const baseUrl = process.env.SNOV_IO_BASE_URL;

    if (!clientId || !clientSecret) {
      throw new Error('SNOV_IO_CLIENT_ID and SNOV_IO_CLIENT_SECRET environment variables are required');
    }

    return new SnovIo({ clientId, clientSecret, baseUrl });
  }

  getClientIdPreview(): string {
    return this.client.getClientIdPreview();
  }

  getClient(): SnovIoClient {
    return this.client;
  }
}

export { SnovIoClient } from './client';
export { CampaignsApi } from './campaigns';
export { DomainSearchApi } from './domain-search';
export { AccountApi } from './account';

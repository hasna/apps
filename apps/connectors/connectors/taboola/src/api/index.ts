import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { AccountApi } from './account';
import { CampaignsApi } from './campaigns';
import { CampaignItemsApi } from './campaign-items';
import { ReportsApi } from './reports';
import { AudiencesApi } from './audiences';

export class Connector {
  private readonly client: ConnectorClient;
  private readonly defaultAccountId?: string;

  public readonly account: AccountApi;
  public readonly campaigns: CampaignsApi;
  public readonly items: CampaignItemsApi;
  public readonly reports: ReportsApi;
  public readonly audiences: AudiencesApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.defaultAccountId = config.accountId;
    this.account = new AccountApi(this.client);
    this.campaigns = new CampaignsApi(this.client);
    this.items = new CampaignItemsApi(this.client);
    this.reports = new ReportsApi(this.client);
    this.audiences = new AudiencesApi(this.client);
  }

  static fromEnv(): Connector {
    const clientId = process.env.TABOOLA_CLIENT_ID;
    const clientSecret = process.env.TABOOLA_CLIENT_SECRET;
    const accessToken = process.env.TABOOLA_ACCESS_TOKEN;
    const accountId = process.env.TABOOLA_ACCOUNT_ID;

    if (!accessToken && !(clientId && clientSecret)) {
      throw new Error(
        'Set TABOOLA_CLIENT_ID and TABOOLA_CLIENT_SECRET (or TABOOLA_ACCESS_TOKEN) to authenticate'
      );
    }

    return new Connector({ clientId, clientSecret, accessToken, accountId });
  }

  getAccountId(): string | undefined {
    return this.defaultAccountId;
  }

  getClientIdPreview(): string {
    return this.client.getClientIdPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { AccountApi } from './account';
export { CampaignsApi } from './campaigns';
export { CampaignItemsApi } from './campaign-items';
export { ReportsApi } from './reports';
export { AudiencesApi } from './audiences';

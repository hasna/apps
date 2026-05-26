import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ContactsApi } from './contacts';
import { GroupsApi } from './groups';
import { CampaignsApi } from './campaigns';
import { ReportsApi } from './reports';
import { AutomationsApi } from './automations';
import { TemplatesApi } from './templates';
import { WebhooksApi } from './webhooks';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly contacts: ContactsApi;
  public readonly groups: GroupsApi;
  public readonly campaigns: CampaignsApi;
  public readonly reports: ReportsApi;
  public readonly automations: AutomationsApi;
  public readonly templates: TemplatesApi;
  public readonly webhooks: WebhooksApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.contacts = new ContactsApi(this.client);
    this.groups = new GroupsApi(this.client);
    this.campaigns = new CampaignsApi(this.client);
    this.reports = new ReportsApi(this.client);
    this.automations = new AutomationsApi(this.client);
    this.templates = new TemplatesApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.ACTIVETRAIL_API_KEY;
    if (!apiKey) {
      throw new Error('ACTIVETRAIL_API_KEY environment variable is required');
    }
    return new Connector({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { ContactsApi } from './contacts';
export { GroupsApi } from './groups';
export { CampaignsApi } from './campaigns';
export { ReportsApi } from './reports';
export { AutomationsApi } from './automations';
export { TemplatesApi } from './templates';
export { WebhooksApi } from './webhooks';

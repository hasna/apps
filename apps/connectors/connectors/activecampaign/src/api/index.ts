import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ContactsApi } from './contacts';
import { DealsApi } from './deals';
import { AccountsApi } from './accounts';
import { CampaignsApi } from './campaigns';
import { TagsApi } from './tags';
import { ListsApi } from './lists';
import { AutomationsApi } from './automations';
import { WebhooksApi } from './webhooks';
import { NotesApi } from './notes';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly contacts: ContactsApi;
  public readonly deals: DealsApi;
  public readonly accounts: AccountsApi;
  public readonly campaigns: CampaignsApi;
  public readonly tags: TagsApi;
  public readonly lists: ListsApi;
  public readonly automations: AutomationsApi;
  public readonly webhooks: WebhooksApi;
  public readonly notes: NotesApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.contacts = new ContactsApi(this.client);
    this.deals = new DealsApi(this.client);
    this.accounts = new AccountsApi(this.client);
    this.campaigns = new CampaignsApi(this.client);
    this.tags = new TagsApi(this.client);
    this.lists = new ListsApi(this.client);
    this.automations = new AutomationsApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
    this.notes = new NotesApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.ACTIVECAMPAIGN_API_KEY;
    const baseUrl = process.env.ACTIVECAMPAIGN_BASE_URL;

    if (!apiKey) {
      throw new Error('ACTIVECAMPAIGN_API_KEY environment variable is required');
    }
    if (!baseUrl) {
      throw new Error('ACTIVECAMPAIGN_BASE_URL environment variable is required (e.g. https://youraccountname.api-us1.com)');
    }
    return new Connector({ apiKey, baseUrl });
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
export { DealsApi } from './deals';
export { AccountsApi } from './accounts';
export { CampaignsApi } from './campaigns';
export { TagsApi } from './tags';
export { ListsApi } from './lists';
export { AutomationsApi } from './automations';
export { WebhooksApi } from './webhooks';
export { NotesApi } from './notes';

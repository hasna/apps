import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { AccountsApi } from './accounts';
import { DomainsApi } from './domains';
import { KeywordsApi } from './keywords';
import { LandingPagesApi } from './landing-pages';
import { TagsApi } from './tags';
import { GroupsApi } from './groups';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly accounts: AccountsApi;
  public readonly domains: DomainsApi;
  public readonly keywords: KeywordsApi;
  public readonly landingPages: LandingPagesApi;
  public readonly tags: TagsApi;
  public readonly groups: GroupsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.accounts = new AccountsApi(this.client);
    this.domains = new DomainsApi(this.client);
    this.keywords = new KeywordsApi(this.client);
    this.landingPages = new LandingPagesApi(this.client);
    this.tags = new TagsApi(this.client);
    this.groups = new GroupsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.ACCURANKER_API_KEY;

    if (!apiKey) {
      throw new Error('ACCURANKER_API_KEY environment variable is required');
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
export { AccountsApi } from './accounts';
export { DomainsApi } from './domains';
export { KeywordsApi } from './keywords';
export { LandingPagesApi } from './landing-pages';
export { TagsApi } from './tags';
export { GroupsApi } from './groups';

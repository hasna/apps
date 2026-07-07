import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { UsersApi } from './users';
import { CompaniesApi } from './companies';
import { RelationshipsApi } from './relationships';
import { EventsApi } from './events';
import { MessagesApi } from './messages';

export class Userlist {
  private readonly client: ConnectorClient;

  public readonly users: UsersApi;
  public readonly companies: CompaniesApi;
  public readonly relationships: RelationshipsApi;
  public readonly events: EventsApi;
  public readonly messages: MessagesApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.users = new UsersApi(this.client);
    this.companies = new CompaniesApi(this.client);
    this.relationships = new RelationshipsApi(this.client);
    this.events = new EventsApi(this.client);
    this.messages = new MessagesApi(this.client);
  }

  static fromEnv(): Userlist {
    const key = process.env.USERLIST_PUSH_API_KEY;
    if (!key) {
      throw new Error('USERLIST_PUSH_API_KEY environment variable is required');
    }
    return new Userlist({
      apiKey: key,
      baseUrl: process.env.USERLIST_PUSH_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { UsersApi } from './users';
export { CompaniesApi } from './companies';
export { RelationshipsApi } from './relationships';
export { EventsApi } from './events';
export { MessagesApi } from './messages';

/** @deprecated Use Userlist instead */
export { Userlist as Connector };

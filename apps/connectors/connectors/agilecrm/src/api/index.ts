import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ContactsApi } from './contacts';
import { DealsApi } from './deals';
import { TasksApi } from './tasks';
import { NotesApi } from './notes';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly contacts: ContactsApi;
  public readonly deals: DealsApi;
  public readonly tasks: TasksApi;
  public readonly notes: NotesApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.contacts = new ContactsApi(this.client);
    this.deals = new DealsApi(this.client);
    this.tasks = new TasksApi(this.client);
    this.notes = new NotesApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.AGILECRM_API_KEY;
    const email = process.env.AGILECRM_EMAIL;
    const domain = process.env.AGILECRM_DOMAIN;

    if (!apiKey) {
      throw new Error('AGILECRM_API_KEY environment variable is required');
    }
    if (!email) {
      throw new Error('AGILECRM_EMAIL environment variable is required');
    }
    if (!domain) {
      throw new Error('AGILECRM_DOMAIN environment variable is required');
    }
    return new Connector({ apiKey, email, domain });
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
export { TasksApi } from './tasks';
export { NotesApi } from './notes';

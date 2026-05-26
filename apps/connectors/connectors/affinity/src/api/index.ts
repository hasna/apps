import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { PersonsApi } from './persons';
import { OrganizationsApi } from './organizations';
import { OpportunitiesApi } from './opportunities';
import { ListsApi } from './lists';
import { NotesApi } from './notes';
import { FieldValuesApi } from './fields';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly persons: PersonsApi;
  public readonly organizations: OrganizationsApi;
  public readonly opportunities: OpportunitiesApi;
  public readonly lists: ListsApi;
  public readonly notes: NotesApi;
  public readonly fieldValues: FieldValuesApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.persons = new PersonsApi(this.client);
    this.organizations = new OrganizationsApi(this.client);
    this.opportunities = new OpportunitiesApi(this.client);
    this.lists = new ListsApi(this.client);
    this.notes = new NotesApi(this.client);
    this.fieldValues = new FieldValuesApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.AFFINITY_API_KEY;

    if (!apiKey) {
      throw new Error('AFFINITY_API_KEY environment variable is required');
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
export { PersonsApi } from './persons';
export { OrganizationsApi } from './organizations';
export { OpportunitiesApi } from './opportunities';
export { ListsApi } from './lists';
export { NotesApi } from './notes';
export { FieldValuesApi } from './fields';

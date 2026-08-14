import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ContactsApi } from './contacts';
import { CasesApi } from './cases';
import { CompaniesApi } from './companies';
import { NotesApi } from './notes';
import { KnowledgeBaseApi } from './knowledge-base';
import { AnalyticsApi } from './analytics';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly contacts: ContactsApi;
  public readonly cases: CasesApi;
  public readonly companies: CompaniesApi;
  public readonly notes: NotesApi;
  public readonly knowledgeBase: KnowledgeBaseApi;
  public readonly analytics: AnalyticsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.contacts = new ContactsApi(this.client);
    this.cases = new CasesApi(this.client);
    this.companies = new CompaniesApi(this.client);
    this.notes = new NotesApi(this.client);
    this.knowledgeBase = new KnowledgeBaseApi(this.client);
    this.analytics = new AnalyticsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.ACQUIRE_API_KEY;
    const accountId = process.env.ACQUIRE_ACCOUNT_ID;

    if (!apiKey) {
      throw new Error('ACQUIRE_API_KEY environment variable is required');
    }
    return new Connector({ apiKey, accountId });
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
export { CasesApi } from './cases';
export { CompaniesApi } from './companies';
export { NotesApi } from './notes';
export { KnowledgeBaseApi } from './knowledge-base';
export { AnalyticsApi } from './analytics';

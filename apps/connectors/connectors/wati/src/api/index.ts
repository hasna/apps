import type { WatiConfig } from '../types';
import { WatiClient } from './client';
import { ContactsApi } from './contacts';
import { MessagesApi } from './messages';
import { TemplatesApi } from './templates';
import { OperatorsApi } from './operators';
import { LabelsApi } from './labels';
import { AttributesApi } from './attributes';
import { BroadcastsApi } from './broadcasts';

export class Wati {
  private readonly client: WatiClient;

  public readonly contacts: ContactsApi;
  public readonly messages: MessagesApi;
  public readonly templates: TemplatesApi;
  public readonly operators: OperatorsApi;
  public readonly labels: LabelsApi;
  public readonly attributes: AttributesApi;
  public readonly broadcasts: BroadcastsApi;

  constructor(config: WatiConfig) {
    this.client = new WatiClient(config);
    this.contacts = new ContactsApi(this.client);
    this.messages = new MessagesApi(this.client);
    this.templates = new TemplatesApi(this.client);
    this.operators = new OperatorsApi(this.client);
    this.labels = new LabelsApi(this.client);
    this.attributes = new AttributesApi(this.client);
    this.broadcasts = new BroadcastsApi(this.client);
  }

  static fromEnv(): Wati {
    const apiKey = process.env.WATI_API_KEY;
    const baseUrl = process.env.WATI_BASE_URL;

    if (!apiKey) {
      throw new Error('WATI_API_KEY environment variable is required');
    }
    if (!baseUrl) {
      throw new Error('WATI_BASE_URL environment variable is required');
    }

    return new Wati({ apiKey, baseUrl });
  }

  getClient(): WatiClient {
    return this.client;
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }
}

export { WatiClient } from './client';
export { ContactsApi } from './contacts';
export { MessagesApi } from './messages';
export { TemplatesApi } from './templates';
export { OperatorsApi } from './operators';
export { LabelsApi } from './labels';
export { AttributesApi } from './attributes';
export { BroadcastsApi } from './broadcasts';

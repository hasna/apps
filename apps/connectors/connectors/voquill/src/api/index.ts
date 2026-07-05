import type { ConnectorConfig } from '../types';
import type { JsonRecord } from '../types';
import { ConnectorClient } from './client';
import { CasesApi } from './cases';
import { ReportsApi } from './reports';
import { TemplatesApi } from './templates';
import { SnippetsApi } from './snippets';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly cases: CasesApi;
  public readonly reports: ReportsApi;
  public readonly templates: TemplatesApi;
  public readonly snippets: SnippetsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.cases = new CasesApi(this.client);
    this.reports = new ReportsApi(this.client);
    this.templates = new TemplatesApi(this.client);
    this.snippets = new SnippetsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.VOQUILL_API_KEY;
    const baseUrl = process.env.VOQUILL_BASE_URL;

    if (!apiKey) {
      throw new Error('VOQUILL_API_KEY environment variable is required');
    }
    return new Connector({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  async rawRequest(options: {
    path: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    body?: JsonRecord;
    params?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
  }): Promise<JsonRecord> {
    const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
    return this.client.request<JsonRecord>(path, {
      method: options.method ?? 'GET',
      body: options.body,
      params: options.params,
      headers: options.headers,
    });
  }
}

export { ConnectorClient, encodePathSegment } from './client';
export { CasesApi } from './cases';
export { ReportsApi } from './reports';
export { TemplatesApi } from './templates';
export { SnippetsApi } from './snippets';

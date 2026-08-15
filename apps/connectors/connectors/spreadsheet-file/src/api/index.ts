import type { ConnectorConfig, RawRequestParams } from '../types';
import { ConnectorClient } from './client';
import { FilesApi } from './files';
import { EventsApi } from './events';
import { SearchApi } from './search';

/**
 * SpreadsheetFile API Connector
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly files: FilesApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.files = new FilesApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.SPREADSHEET_FILE_API_KEY;
    const baseUrl = process.env.SPREADSHEET_FILE_BASE_URL;

    if (!apiKey) {
      throw new Error('SPREADSHEET_FILE_API_KEY environment variable is required');
    }

    return new Connector({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  /**
   * Make an arbitrary authenticated API request
   */
  async rawRequest<T = unknown>(params: RawRequestParams): Promise<T> {
    const { path, method = 'GET', query, body, headers } = params;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }
}

export { ConnectorClient } from './client';
export { FilesApi } from './files';
export { EventsApi } from './events';
export { SearchApi } from './search';

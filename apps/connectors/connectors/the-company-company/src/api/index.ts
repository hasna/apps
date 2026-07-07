import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { AgentsApi } from './agents';
import { TasksApi } from './tasks';
import { IntegrationsApi } from './integrations';
import { MemoriesApi } from './memories';
import { EventsApi } from './events';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly agents: AgentsApi;
  public readonly tasks: TasksApi;
  public readonly integrations: IntegrationsApi;
  public readonly memories: MemoriesApi;
  public readonly events: EventsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.agents = new AgentsApi(this.client);
    this.tasks = new TasksApi(this.client);
    this.integrations = new IntegrationsApi(this.client);
    this.memories = new MemoriesApi(this.client);
    this.events = new EventsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.THE_COMPANY_COMPANY_API_KEY;
    const baseUrl = process.env.THE_COMPANY_COMPANY_BASE_URL;

    if (!apiKey) {
      throw new Error('THE_COMPANY_COMPANY_API_KEY environment variable is required');
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
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    params?: Record<string, string | number | boolean | undefined>;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  }): Promise<unknown> {
    return this.client.request(options.path, {
      method: options.method ?? 'GET',
      params: options.params,
      body: options.body,
      headers: options.headers,
    });
  }
}

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { AgentsApi } from './agents';
export { TasksApi } from './tasks';
export { IntegrationsApi } from './integrations';
export { MemoriesApi } from './memories';
export { EventsApi } from './events';

import type { UnissonConfig } from '../types';
import { UnissonClient } from './client';
import { AgentsApi } from './agents';
import { TasksApi } from './tasks';
import { KnowledgeApi } from './knowledge';

export { UnissonClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
export { AgentsApi } from './agents';
export { TasksApi } from './tasks';
export { KnowledgeApi } from './knowledge';

export class Unisson {
  private readonly client: UnissonClient;
  public readonly agents: AgentsApi;
  public readonly tasks: TasksApi;
  public readonly knowledge: KnowledgeApi;

  constructor(config: UnissonConfig) {
    this.client = new UnissonClient(config);
    this.agents = new AgentsApi(this.client);
    this.tasks = new TasksApi(this.client);
    this.knowledge = new KnowledgeApi(this.client);
  }

  static fromEnv(): Unisson {
    const apiKey = process.env.UNISSON_API_KEY;
    if (!apiKey) {
      throw new Error('UNISSON_API_KEY environment variable is required');
    }
    return new Unisson({
      apiKey,
      baseUrl: process.env.UNISSON_BASE_URL,
    });
  }

  async rawRequest(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      query?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<unknown> {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return this.client.request(normalizedPath, {
      method: options.method ?? 'GET',
      params: options.query,
      body: options.body,
      headers: options.headers,
    });
  }

  getClient(): UnissonClient {
    return this.client;
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export const Connector = Unisson;

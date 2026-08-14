import type { ConnectorConfig, RawRequestParams } from '../types';
import { ConnectorClient } from './client';
import { ProjectsApi } from './projects';
import { AgentsApi } from './agents';
import { TasksApi } from './tasks';
import { MessagesApi } from './messages';
import { FilesystemsApi } from './filesystems';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly projects: ProjectsApi;
  public readonly agents: AgentsApi;
  public readonly tasks: TasksApi;
  public readonly messages: MessagesApi;
  public readonly filesystems: FilesystemsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.projects = new ProjectsApi(this.client);
    this.agents = new AgentsApi(this.client);
    this.tasks = new TasksApi(this.client);
    this.messages = new MessagesApi(this.client);
    this.filesystems = new FilesystemsApi(this.client);
  }

  static fromEnv(): Connector {
    const token =
      process.env.TERMINAL_USE_TOKEN ||
      process.env.TERMINALUSE_API_KEY;

    if (!token) {
      throw new Error('TERMINAL_USE_TOKEN or TERMINALUSE_API_KEY environment variable is required');
    }

    return new Connector({
      token,
      agentApiKey: process.env.TERMINAL_USE_AGENT_API_KEY,
      baseUrl: process.env.TERMINAL_USE_BASE_URL,
    });
  }

  rawRequest<T = unknown>(params: RawRequestParams): Promise<T> {
    const { path, method = 'GET', params: query, body, headers } = params;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }

  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { ProjectsApi } from './projects';
export { AgentsApi } from './agents';
export { TasksApi } from './tasks';
export { MessagesApi } from './messages';
export { FilesystemsApi } from './filesystems';

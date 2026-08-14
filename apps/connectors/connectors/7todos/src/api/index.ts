import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { TasksApi } from './tasks';

export class Connector {
  private readonly client: ConnectorClient;
  public readonly tasks: TasksApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.tasks = new TasksApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.SEVENTODOS_API_KEY;
    const workspaceId = process.env.SEVENTODOS_WORKSPACE_ID;

    if (!apiKey) {
      throw new Error('SEVENTODOS_API_KEY environment variable is required');
    }
    if (!workspaceId) {
      throw new Error('SEVENTODOS_WORKSPACE_ID environment variable is required');
    }
    return new Connector({ apiKey, workspaceId });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { TasksApi } from './tasks';

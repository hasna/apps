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
    const apiKey = process.env.TWOCAPTCHA_API_KEY;
    if (!apiKey) {
      throw new Error('TWOCAPTCHA_API_KEY environment variable is required');
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
export { TasksApi } from './tasks';

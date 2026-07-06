import type { ZatannaConfig } from '../types';
import { ZatannaClient } from './client';
import { WorkflowsApi } from './workflows';

export class Zatanna {
  private readonly client: ZatannaClient;
  readonly workflows: WorkflowsApi;

  constructor(config: ZatannaConfig) {
    this.client = new ZatannaClient(config);
    this.workflows = new WorkflowsApi(this.client);
  }

  static fromEnv(): Zatanna {
    const apiKey = process.env.ZATANNA_API_KEY;
    if (!apiKey) {
      throw new Error('ZATANNA_API_KEY environment variable is required');
    }
    return new Zatanna({
      apiKey,
      baseUrl: process.env.ZATANNA_BASE_URL,
      authHeader: process.env.ZATANNA_AUTH_HEADER,
      defaultWorkspaceId: process.env.ZATANNA_DEFAULT_WORKSPACE_ID,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ZatannaClient {
    return this.client;
  }
}

export { ZatannaClient, DEFAULT_BASE_URL } from './client';
export { WorkflowsApi } from './workflows';

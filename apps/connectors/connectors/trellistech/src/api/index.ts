import type { TrellistechConfig } from '../types';
import { TrellistechClient } from './client';
import { PropertiesApi } from './properties';
import { TasksApi } from './tasks';

export class Trellistech {
  private readonly client: TrellistechClient;

  public readonly properties: PropertiesApi;
  public readonly tasks: TasksApi;

  constructor(config: TrellistechConfig) {
    this.client = new TrellistechClient(config);
    this.properties = new PropertiesApi(this.client);
    this.tasks = new TasksApi(this.client);
  }

  static fromEnv(): Trellistech {
    const apiKey = process.env.TRELLISTECH_API_KEY;
    const workspaceId = process.env.TRELLISTECH_WORKSPACE_ID;
    const baseUrl = process.env.TRELLISTECH_BASE_URL;

    if (!apiKey) {
      throw new Error('TRELLISTECH_API_KEY environment variable is required');
    }
    if (!workspaceId) {
      throw new Error('TRELLISTECH_WORKSPACE_ID environment variable is required');
    }

    return new Trellistech({ apiKey, workspaceId, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getWorkspaceId(): string {
    return this.client.workspaceId;
  }

  getClient(): TrellistechClient {
    return this.client;
  }
}

export { TrellistechClient } from './client';
export { PropertiesApi } from './properties';
export { TasksApi } from './tasks';

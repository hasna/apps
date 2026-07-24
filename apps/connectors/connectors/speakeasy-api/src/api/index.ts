import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { AuthApi } from './auth';
import { ApisApi } from './apis';
import { EndpointsApi } from './endpoints';
import { MetadataApi } from './metadata';
import { SchemasApi } from './schemas';
import { EventlogApi } from './eventlog';
import { EmbedsApi } from './embeds';
import { EventsApi } from './events';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly auth: AuthApi;
  public readonly apis: ApisApi;
  public readonly endpoints: EndpointsApi;
  public readonly metadata: MetadataApi;
  public readonly schemas: SchemasApi;
  public readonly eventlog: EventlogApi;
  public readonly embeds: EmbedsApi;
  public readonly events: EventsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.auth = new AuthApi(this.client);
    this.apis = new ApisApi(this.client);
    this.endpoints = new EndpointsApi(this.client);
    this.metadata = new MetadataApi(this.client);
    this.schemas = new SchemasApi(this.client);
    this.eventlog = new EventlogApi(this.client);
    this.embeds = new EmbedsApi(this.client);
    this.events = new EventsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.SPEAKEASY_API_KEY || process.env.SPEAKEASY_TOKEN;
    if (!apiKey) {
      throw new Error('SPEAKEASY_API_KEY environment variable is required');
    }
    return new Connector({
      apiKey,
      baseUrl: process.env.SPEAKEASY_BASE_URL,
      workspaceId: process.env.SPEAKEASY_WORKSPACE_ID,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  /** Escape hatch for unlisted endpoints */
  raw<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[] | string;
    }
  ): Promise<T> {
    return this.client.request<T>(path, {
      method,
      params: options?.params,
      body: options?.body,
    });
  }
}

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { AuthApi } from './auth';
export { ApisApi } from './apis';
export { EndpointsApi } from './endpoints';
export { MetadataApi } from './metadata';
export { SchemasApi } from './schemas';
export { EventlogApi } from './eventlog';
export { EmbedsApi } from './embeds';
export { EventsApi } from './events';

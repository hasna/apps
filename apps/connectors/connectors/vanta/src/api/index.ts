import { VantaClient, type VantaClientConfig } from './client';
import { ControlsApi } from './controls';
import { EventsApi } from './events';
import { DocumentsApi } from './documents';
import type { RawRequestOptions } from '../types';

export class Vanta {
  private readonly client: VantaClient;
  public readonly controls: ControlsApi;
  public readonly events: EventsApi;
  public readonly documents: DocumentsApi;

  constructor(config: VantaClientConfig) {
    this.client = new VantaClient(config);
    this.controls = new ControlsApi(this.client);
    this.events = new EventsApi(this.client);
    this.documents = new DocumentsApi(this.client);
  }

  static fromEnv(): Vanta {
    const clientId = process.env.VANTA_CLIENT_ID;
    const clientSecret = process.env.VANTA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('VANTA_CLIENT_ID and VANTA_CLIENT_SECRET environment variables are required');
    }

    return new Vanta({
      clientId,
      clientSecret,
      scope: process.env.VANTA_SCOPE,
      baseUrl: process.env.VANTA_BASE_URL,
    });
  }

  rawRequest<T = unknown>(path: string, options: RawRequestOptions = {}): Promise<T> {
    return this.client.request<T>(path, {
      method: options.method,
      params: options.query,
      body: options.body,
    });
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }
}

export { VantaClient } from './client';
export { ControlsApi } from './controls';
export { EventsApi } from './events';
export { DocumentsApi } from './documents';

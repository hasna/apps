import type {
  ModalConfig,
  WebEndpointRequest,
  WebEndpointResponse,
  AppsListResponse,
  SecretsListResponse
} from '../types';
import { ModalClient } from './client';

export class Modal {
  private readonly client: ModalClient;

  constructor(config: ModalConfig) {
    this.client = new ModalClient(config);
  }

  static fromEnv(): Modal {
    const tokenId = process.env.MODAL_TOKEN_ID;
    const tokenSecret = process.env.MODAL_TOKEN_SECRET;
    if (!tokenId || !tokenSecret) {
      throw new Error('MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables are required');
    }
    return new Modal({ tokenId, tokenSecret });
  }

  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  async callWebEndpoint(url: string, data?: WebEndpointRequest): Promise<WebEndpointResponse> {
    // Direct call to a Modal web endpoint
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Web endpoint error: ${response.status} - ${text}`);
    }

    return response.json();
  }

  async listApps(): Promise<AppsListResponse> {
    return this.client.get<AppsListResponse>('/apps');
  }

  async listSecrets(): Promise<SecretsListResponse> {
    return this.client.get<SecretsListResponse>('/secrets');
  }

  async createSecret(name: string, values: Record<string, string>): Promise<void> {
    await this.client.post('/secrets', { name, values });
  }

  async deleteSecret(name: string): Promise<void> {
    await this.client.delete(`/secrets/${name}`);
  }

  getClient(): ModalClient {
    return this.client;
  }
}

export { ModalClient } from './client';

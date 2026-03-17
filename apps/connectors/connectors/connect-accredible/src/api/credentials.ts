import type { ConnectorClient } from './client';
import type {
  Credential,
  CredentialResponse,
  CredentialListResponse,
  CredentialCreateParams,
  CredentialUpdateParams,
  ListParams,
} from '../types';

export class CredentialsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams & { group_id?: number; email?: string }): Promise<CredentialListResponse> {
    return this.client.get<CredentialListResponse>('/all_credentials', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: number): Promise<CredentialResponse> {
    return this.client.get<CredentialResponse>(`/credentials/${id}`);
  }

  async create(params: CredentialCreateParams): Promise<CredentialResponse> {
    return this.client.post<CredentialResponse>('/credentials', params);
  }

  async update(id: number, params: CredentialUpdateParams): Promise<CredentialResponse> {
    return this.client.put<CredentialResponse>(`/credentials/${id}`, params);
  }

  async delete(id: number): Promise<void> {
    await this.client.delete(`/credentials/${id}`);
  }
}

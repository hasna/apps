import type { ConnectorClient } from './client';
import type { Petition, PetitionCreateParams, SignatureCreateParams, ListParams } from '../types';

export class PetitionsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.page) queryParams.page = params.page;
    if (params?.per_page) queryParams.per_page = params.per_page;
    if (params?.filter) queryParams.filter = params.filter;
    return this.client.get<unknown>('/petitions', queryParams);
  }

  async get(petitionId: string): Promise<Petition> {
    return this.client.get<Petition>(`/petitions/${petitionId}`);
  }

  async create(params: PetitionCreateParams): Promise<Petition> {
    return this.client.post<Petition>('/petitions', params);
  }

  async update(petitionId: string, params: Partial<PetitionCreateParams>): Promise<Petition> {
    return this.client.put<Petition>(`/petitions/${petitionId}`, params);
  }

  async listSignatures(petitionId: string, params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.page) queryParams.page = params.page;
    if (params?.per_page) queryParams.per_page = params.per_page;
    return this.client.get<unknown>(`/petitions/${petitionId}/signatures`, queryParams);
  }

  async createSignature(petitionId: string, params: SignatureCreateParams): Promise<unknown> {
    return this.client.post<unknown>(`/petitions/${petitionId}/signatures`, params);
  }
}

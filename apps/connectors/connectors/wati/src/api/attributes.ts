import type { WatiClient } from './client';
import type { CreateCustomAttributeParams, WatiApiResponse } from '../types';

export class AttributesApi {
  constructor(private readonly client: WatiClient) {}

  async getCustomAttributes(): Promise<WatiApiResponse> {
    return this.client.get<WatiApiResponse>('/api/v1/getAttributes');
  }

  async createCustomAttribute(params: CreateCustomAttributeParams): Promise<WatiApiResponse> {
    return this.client.post<WatiApiResponse>('/api/v1/createAttribute', {
      name: params.name,
      type: params.type,
    });
  }
}

import type { WatiClient } from './client';
import type { PaginationParams, WatiApiResponse } from '../types';

export class TemplatesApi {
  constructor(private readonly client: WatiClient) {}

  async getMessageTemplates(params: PaginationParams = {}): Promise<WatiApiResponse> {
    return this.client.get<WatiApiResponse>('/api/v1/getMessageTemplates', {
      pageSize: params.pageSize,
      pageNumber: params.pageNumber,
    });
  }
}

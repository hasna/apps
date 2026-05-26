import type { PandaDocClient } from './client';
import type { Form, FormListResponse } from '../types';

export interface FormListOptions {
  count?: number;
  page?: number;
  status?: string;
}

/**
 * Forms API - Manage PandaDoc forms
 */
export class FormsApi {
  constructor(private readonly client: PandaDocClient) {}

  /**
   * List forms
   */
  async list(options?: FormListOptions): Promise<FormListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options) {
      if (options.count) params.count = options.count;
      if (options.page) params.page = options.page;
      if (options.status) params.status = options.status;
    }

    return this.client.get<FormListResponse>('/forms', params);
  }

  /**
   * Get form by ID
   */
  async get(id: string): Promise<Form> {
    return this.client.get<Form>(`/forms/${id}`);
  }
}

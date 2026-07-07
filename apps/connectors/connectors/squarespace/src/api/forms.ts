import type { SquarespaceClient } from './client';
import type { Form } from '../types';

export interface FormsListResponse {
  forms: Form[];
}

export interface FormSubmissionsResponse {
  submissions: Array<Record<string, unknown>>;
  pagination?: { nextPageCursor?: string; hasNextPage?: boolean };
}

export class FormsApi {
  constructor(private readonly client: SquarespaceClient) {}

  async list(): Promise<FormsListResponse> {
    return this.client.request<FormsListResponse>('/forms');
  }

  async listSubmissions(formId: string, cursor?: string): Promise<FormSubmissionsResponse> {
    return this.client.request<FormSubmissionsResponse>(
      `/forms/${encodeURIComponent(formId)}/submissions`,
      { params: { cursor } },
    );
  }
}

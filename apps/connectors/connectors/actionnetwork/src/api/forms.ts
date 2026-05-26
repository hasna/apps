import type { ConnectorClient } from './client';
import type { Form, FormCreateParams, SubmissionCreateParams, ListParams } from '../types';

export class FormsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.page) queryParams.page = params.page;
    if (params?.per_page) queryParams.per_page = params.per_page;
    if (params?.filter) queryParams.filter = params.filter;
    return this.client.get<unknown>('/forms', queryParams);
  }

  async get(formId: string): Promise<Form> {
    return this.client.get<Form>(`/forms/${formId}`);
  }

  async create(params: FormCreateParams): Promise<Form> {
    return this.client.post<Form>('/forms', params);
  }

  async update(formId: string, params: Partial<FormCreateParams>): Promise<Form> {
    return this.client.put<Form>(`/forms/${formId}`, params);
  }

  async listSubmissions(formId: string, params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.page) queryParams.page = params.page;
    if (params?.per_page) queryParams.per_page = params.per_page;
    return this.client.get<unknown>(`/forms/${formId}/submissions`, queryParams);
  }

  async createSubmission(formId: string, params: SubmissionCreateParams): Promise<unknown> {
    return this.client.post<unknown>(`/forms/${formId}/submissions`, params);
  }
}

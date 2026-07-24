import type { WufooClient } from './client';
import { encodeResourceId } from './client';
import type {
  ListParams,
  WufooCommentsCountResponse,
  WufooCommentsResponse,
  WufooFieldsResponse,
  WufooFormResponse,
  WufooFormsResponse,
} from '../types';

function toQueryParams(params?: ListParams): Record<string, string | number | boolean | undefined> {
  if (!params) return {};
  const query: Record<string, string | number | boolean | undefined> = {};
  if (params.page !== undefined) query.page = params.page;
  if (params.limit !== undefined) query.limit = params.limit;
  if (params.pretty !== undefined) query.pretty = params.pretty;
  if (params.includeTodayCount !== undefined) query.includeTodayCount = params.includeTodayCount;
  return query;
}

export class FormsApi {
  constructor(private readonly client: WufooClient) {}

  async list(params?: ListParams): Promise<WufooFormsResponse> {
    return this.client.get<WufooFormsResponse>('/forms.json', toQueryParams(params));
  }

  async get(formId: string): Promise<WufooFormResponse> {
    const id = encodeResourceId(formId);
    return this.client.get<WufooFormResponse>(`/forms/${id}.json`);
  }

  async listFields(formId: string): Promise<WufooFieldsResponse> {
    const id = encodeResourceId(formId);
    return this.client.get<WufooFieldsResponse>(`/forms/${id}/fields.json`);
  }

  async listComments(formId: string, params?: ListParams): Promise<WufooCommentsResponse> {
    const id = encodeResourceId(formId);
    return this.client.get<WufooCommentsResponse>(
      `/forms/${id}/comments.json`,
      toQueryParams(params),
    );
  }

  async getCommentsCount(formId: string): Promise<WufooCommentsCountResponse> {
    const id = encodeResourceId(formId);
    return this.client.get<WufooCommentsCountResponse>(`/forms/${id}/comments/count.json`);
  }
}

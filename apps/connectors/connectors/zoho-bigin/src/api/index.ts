import { ZohoBiginClient } from './client';
import type {
  ZohoBiginConfig,
  ZohoBiginRecord,
  ZohoBiginRecordList,
  ZohoBiginPipeline,
  ZohoBiginTask,
} from '../types';

export { ZohoBiginClient, DEFAULT_BASE_URL } from './client';

export class ZohoBigin {
  private readonly client: ZohoBiginClient;

  constructor(config: ZohoBiginConfig) {
    this.client = new ZohoBiginClient(config);
  }

  static fromEnv(): ZohoBigin {
    const token = process.env.ZOHOBGIN_TOKEN;
    if (!token) {
      throw new Error('ZOHOBGIN_TOKEN is required');
    }
    return new ZohoBigin({
      token,
      baseUrl: process.env.ZOHOBGIN_BASE_URL,
    });
  }

  async listContacts(options?: {
    page?: number;
    per_page?: number;
    fields?: string;
    sort_by?: string;
    sort_order?: string;
  }): Promise<ZohoBiginRecordList> {
    return this.client.request<ZohoBiginRecordList>('/Contacts', {
      params: {
        page: options?.page,
        per_page: options?.per_page,
        fields: options?.fields,
        sort_by: options?.sort_by,
        sort_order: options?.sort_order,
      },
    });
  }

  async getContact(contactId: string): Promise<{ data: ZohoBiginRecord[] }> {
    return this.client.request(`/Contacts/${encodeURIComponent(contactId)}`);
  }

  async addContacts(records: Record<string, unknown>[]): Promise<{ data: ZohoBiginRecord[] }> {
    return this.client.request('/Contacts', {
      method: 'POST',
      body: { data: records },
    });
  }

  async listCompanies(options?: {
    page?: number;
    per_page?: number;
    fields?: string;
    sort_by?: string;
    sort_order?: string;
  }): Promise<ZohoBiginRecordList> {
    return this.client.request<ZohoBiginRecordList>('/Accounts', {
      params: {
        page: options?.page,
        per_page: options?.per_page,
        fields: options?.fields,
        sort_by: options?.sort_by,
        sort_order: options?.sort_order,
      },
    });
  }

  async listPipelines(options?: {
    page?: number;
    per_page?: number;
  }): Promise<{ data: ZohoBiginPipeline[] }> {
    return this.client.request('/Pipelines', {
      params: {
        page: options?.page,
        per_page: options?.per_page,
      },
    });
  }

  async listTasks(options?: {
    page?: number;
    per_page?: number;
    fields?: string;
  }): Promise<{ data: ZohoBiginTask[] }> {
    return this.client.request('/Tasks', {
      params: {
        page: options?.page,
        per_page: options?.per_page,
        fields: options?.fields,
      },
    });
  }

  async rawRequest(
    path: string,
    method = 'GET',
    body?: Record<string, unknown> | unknown[],
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<unknown> {
    return this.client.request(path, { method, body, params: query });
  }

  getClient(): ZohoBiginClient {
    return this.client;
  }
}

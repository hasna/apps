import type {
  ModuleFilterParams,
  ModuleGetParams,
  ModuleListParams,
  ModuleListResponse,
  ModuleSearchParams,
  SugarRecord,
} from '../types';
import type { ConnectorClient } from './client';

function encodeModule(module: string): string {
  return encodeURIComponent(module);
}

function buildListParams(options: ModuleListParams = {}): Record<string, string | number | undefined> {
  return {
    fields: options.fields?.join(','),
    order_by: options.orderBy,
    max_num: options.maxNum,
    offset: options.offset,
    filter: options.filter ? JSON.stringify([options.filter]) : undefined,
  };
}

export class ModulesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(module: string, options: ModuleListParams = {}): Promise<ModuleListResponse> {
    return this.client.get<ModuleListResponse>(`/${encodeModule(module)}`, buildListParams(options));
  }

  async get(module: string, id: string, options: ModuleGetParams = {}): Promise<SugarRecord> {
    return this.client.get<SugarRecord>(`/${encodeModule(module)}/${encodeURIComponent(id)}`, {
      fields: options.fields?.join(','),
    });
  }

  async create(module: string, data: Record<string, unknown>): Promise<SugarRecord> {
    return this.client.post<SugarRecord>(`/${encodeModule(module)}`, data);
  }

  async update(module: string, id: string, data: Record<string, unknown>): Promise<SugarRecord> {
    return this.client.put<SugarRecord>(
      `/${encodeModule(module)}/${encodeURIComponent(id)}`,
      data
    );
  }

  async delete(module: string, id: string): Promise<unknown> {
    return this.client.delete(`/${encodeModule(module)}/${encodeURIComponent(id)}`);
  }

  async search(module: string, options: ModuleSearchParams): Promise<ModuleListResponse> {
    return this.client.get<ModuleListResponse>(`/${encodeModule(module)}`, {
      q: options.q,
      fields: options.fields?.join(','),
      max_num: options.maxNum,
      offset: options.offset,
    });
  }

  async filter(module: string, options: ModuleFilterParams): Promise<ModuleListResponse> {
    return this.client.post<ModuleListResponse>(`/${encodeModule(module)}/filter`, {
      filter: options.filter,
      fields: options.fields,
      order_by: options.orderBy,
      max_num: options.maxNum,
      offset: options.offset,
    });
  }

  async listAccounts(options: ModuleListParams = {}): Promise<ModuleListResponse> {
    return this.list('Accounts', options);
  }

  async listContacts(options: ModuleListParams = {}): Promise<ModuleListResponse> {
    return this.list('Contacts', options);
  }

  async listLeads(options: ModuleListParams = {}): Promise<ModuleListResponse> {
    return this.list('Leads', options);
  }

  async listOpportunities(options: ModuleListParams = {}): Promise<ModuleListResponse> {
    return this.list('Opportunities', options);
  }

  async listCases(options: ModuleListParams = {}): Promise<ModuleListResponse> {
    return this.list('Cases', options);
  }
}

import type { ConnectorClient } from './client';
import type { Company, CompanyCreateParams, CompanyUpdateParams, ListParams } from '../types';

export class CompaniesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.where) queryParams.where = params.where;
    if (params?.relations) queryParams.relations = params.relations;
    if (params?.select) queryParams.select = params.select;
    return this.client.get<unknown>('/crm/objects/company', queryParams);
  }

  async get(companyId: number, params?: { relations?: string }): Promise<Company> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.relations) queryParams.relations = params.relations;
    return this.client.get<Company>(`/crm/objects/company/${companyId}`, queryParams);
  }

  async create(params: CompanyCreateParams): Promise<Company> {
    return this.client.post<Company>('/crm/objects/company', params);
  }

  async update(companyId: number, params: CompanyUpdateParams): Promise<Company> {
    return this.client.put<Company>(`/crm/objects/company/${companyId}`, params);
  }

  async delete(companyId: number): Promise<void> {
    await this.client.delete(`/crm/objects/company/${companyId}`);
  }
}

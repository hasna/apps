import type { ConnectorClient } from './client';
import { V3, toQuery } from './params';
import type {
  ListParams,
  Company,
  CompanyResponse,
  CompaniesResponse,
} from '../types';

export class CompaniesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<CompaniesResponse> {
    return this.client.get<CompaniesResponse>(`${V3}/companies.json`, toQuery(params));
  }

  async get(id: number | string): Promise<CompanyResponse> {
    return this.client.get<CompanyResponse>(`${V3}/companies/${id}.json`);
  }
}

export type { Company };

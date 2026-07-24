import type { UmamiClient } from './client';
import type {
  PaginationParams,
  WebsiteCreateParams,
  WebsiteListParams,
  WebsiteUpdateParams,
} from '../types';

export class WebsitesApi {
  constructor(private readonly client: UmamiClient) {}

  async list(params?: WebsiteListParams): Promise<unknown> {
    return this.client.get('/websites', {
      includeTeams: params?.includeTeams,
      search: params?.search,
      page: params?.page,
      pageSize: params?.pageSize,
    });
  }

  async get(websiteId: string): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}`);
  }

  async create(params: WebsiteCreateParams): Promise<unknown> {
    return this.client.post('/websites', params);
  }

  async update(websiteId: string, params: WebsiteUpdateParams): Promise<unknown> {
    return this.client.post(`/websites/${websiteId}`, params);
  }

  async delete(websiteId: string): Promise<unknown> {
    return this.client.delete(`/websites/${websiteId}`);
  }

  async reset(websiteId: string): Promise<unknown> {
    return this.client.post(`/websites/${websiteId}/reset`);
  }

  async getActive(websiteId: string): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/active`);
  }

  async getDateRange(websiteId: string): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/daterange`);
  }

  async getRecorder(websiteId: string): Promise<unknown> {
    return this.client.get(`/websites/${websiteId}/recorder`);
  }
}

export class TeamsWebsitesApi {
  constructor(private readonly client: UmamiClient) {}

  async list(teamId: string, params?: PaginationParams): Promise<unknown> {
    return this.client.get(`/teams/${teamId}/websites`, {
      search: params?.search,
      page: params?.page,
      pageSize: params?.pageSize,
    });
  }
}

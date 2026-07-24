import type { WistiaClient } from './client';
import type {
  WistiaProject,
  PaginationParams,
  CreateProjectParams,
  CopyProjectParams,
} from '../types';

export class ProjectsApi {
  constructor(private readonly client: WistiaClient) {}

  async list(options: PaginationParams = {}): Promise<WistiaProject[]> {
    return this.client.get<WistiaProject[]>('/v1/projects.json', {
      page: options.page,
      per_page: options.perPage,
      sort_by: options.sortBy,
      sort_direction: options.sortDirection,
    });
  }

  async get(hashedId: string): Promise<WistiaProject> {
    return this.client.get<WistiaProject>(`/v1/projects/${encodeURIComponent(hashedId)}.json`);
  }

  async create(params: CreateProjectParams): Promise<WistiaProject> {
    return this.client.post<WistiaProject>('/v1/projects.json', {
      name: params.name,
      adminEmail: params.adminEmail,
      anonymousCanUpload: params.anonymousCanUpload,
      anonymousCanDownload: params.anonymousCanDownload,
      public: params.isPublic,
    });
  }

  async update(hashedId: string, data: Record<string, unknown>): Promise<WistiaProject> {
    return this.client.put<WistiaProject>(
      `/v1/projects/${encodeURIComponent(hashedId)}.json`,
      data,
    );
  }

  async delete(hashedId: string): Promise<void> {
    await this.client.delete(`/v1/projects/${encodeURIComponent(hashedId)}.json`);
  }

  async copy(hashedId: string, params: CopyProjectParams = {}): Promise<WistiaProject> {
    return this.client.post<WistiaProject>(
      `/v1/projects/${encodeURIComponent(hashedId)}/copy.json`,
      { adminEmail: params.adminEmail },
    );
  }

  async getStats(hashedId: string): Promise<Record<string, unknown>> {
    return this.client.get<Record<string, unknown>>(
      `/v1/stats/projects/${encodeURIComponent(hashedId)}.json`,
    );
  }
}

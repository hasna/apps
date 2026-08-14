import type { ConnectorClient } from './client';
import type { Link, LinkCreateParams, LinkListParams, PaginatedResponse } from '../types';

export class LinksApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(projectId: string, params?: LinkListParams): Promise<PaginatedResponse<Link>> {
    return this.client.get<PaginatedResponse<Link>>(`/v1/projects/${projectId}/links`, params);
  }

  async create(projectId: string, data: LinkCreateParams): Promise<Link> {
    return this.client.post<Link>(`/v1/projects/${projectId}/links`, data as unknown as Record<string, unknown>);
  }
}

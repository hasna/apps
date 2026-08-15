import type { ConnectorClient } from './client';
import type { PaginatedResponse, PaginationParams, Project } from '../types';

export class ProjectsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: PaginationParams): Promise<PaginatedResponse<Project>> {
    return this.client.get<PaginatedResponse<Project>>('/v1/projects/', params);
  }
}

import { encodePathSegment, type TesterArmyClient } from './client';
import type { JsonBody, QueryParams } from '../types';

export class ProjectsApi {
  constructor(private readonly client: TesterArmyClient) {}

  list(params?: QueryParams): Promise<unknown> {
    return this.client.get('/v1/projects', params);
  }

  create(body: JsonBody): Promise<unknown> {
    return this.client.post('/v1/projects', body);
  }

  get(projectId: string, params?: QueryParams): Promise<unknown> {
    return this.client.get(`/v1/projects/${encodePathSegment(projectId)}`, params);
  }

  update(projectId: string, body: JsonBody): Promise<unknown> {
    return this.client.patch(`/v1/projects/${encodePathSegment(projectId)}`, body);
  }

  delete(projectId: string): Promise<unknown> {
    return this.client.delete(`/v1/projects/${encodePathSegment(projectId)}`);
  }

  listCredentials(projectId: string, params?: QueryParams): Promise<unknown> {
    return this.client.get(`/v1/projects/${encodePathSegment(projectId)}/credentials`, params);
  }

  createCredential(projectId: string, body: JsonBody): Promise<unknown> {
    return this.client.post(`/v1/projects/${encodePathSegment(projectId)}/credentials`, body);
  }

  listMemories(projectId: string, params?: QueryParams): Promise<unknown> {
    return this.client.get(`/v1/projects/${encodePathSegment(projectId)}/memories`, params);
  }

  createMemory(projectId: string, body: JsonBody): Promise<unknown> {
    return this.client.post(`/v1/projects/${encodePathSegment(projectId)}/memories`, body);
  }

  deleteMemory(projectId: string, memoryId: string): Promise<unknown> {
    return this.client.delete(
      `/v1/projects/${encodePathSegment(projectId)}/memories/${encodePathSegment(memoryId)}`,
    );
  }

  listFiles(projectId: string, params?: QueryParams): Promise<unknown> {
    return this.client.get(`/v1/projects/${encodePathSegment(projectId)}/files`, params);
  }

  listMobileApps(projectId: string, params?: QueryParams): Promise<unknown> {
    return this.client.get(`/v1/projects/${encodePathSegment(projectId)}/mobile`, params);
  }

  deleteMobileApp(projectId: string, appId: string): Promise<unknown> {
    return this.client.delete(
      `/v1/projects/${encodePathSegment(projectId)}/mobile/${encodePathSegment(appId)}`,
    );
  }

  initiateMobileAppUpload(projectId: string, body: JsonBody): Promise<unknown> {
    return this.client.post(`/v1/projects/${encodePathSegment(projectId)}/mobile/upload`, body);
  }

  confirmMobileAppUpload(projectId: string, body: JsonBody): Promise<unknown> {
    return this.client.post(`/v1/projects/${encodePathSegment(projectId)}/mobile/upload/confirm`, body);
  }
}

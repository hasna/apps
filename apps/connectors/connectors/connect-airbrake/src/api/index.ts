// Airbrake Connector — Error monitoring and performance tracking
import { AirbrakeClient } from './client';
import type { AirbrakeConfig, AirbrakeError, AirbrakeErrorList, AirbrakeNotice, AirbrakeNoticeList, AirbrakeProject, AirbrakeDeployList } from '../types';
export { AirbrakeClient } from './client';

export class Airbrake {
  private readonly client: AirbrakeClient;
  constructor(config: AirbrakeConfig) { this.client = new AirbrakeClient(config); }
  static fromEnv(): Airbrake {
    const projectId = process.env.AIRBRAKE_PROJECT_ID;
    const projectKey = process.env.AIRBRAKE_PROJECT_KEY;
    if (!projectId || !projectKey) throw new Error('AIRBRAKE_PROJECT_ID and AIRBRAKE_PROJECT_KEY are required');
    return new Airbrake({ projectId, projectKey });
  }

  async listErrors(options?: { page?: number; resolved?: boolean }): Promise<AirbrakeErrorList> {
    return this.client.request<AirbrakeErrorList>('/groups', { params: { page: options?.page, resolved: options?.resolved === true ? 'true' : options?.resolved === false ? 'false' : undefined } });
  }
  async getError(errorId: number): Promise<AirbrakeError> { return this.client.request<AirbrakeError>(`/groups/${errorId}`); }
  async resolveError(errorId: number): Promise<AirbrakeError> { return this.client.request<AirbrakeError>(`/groups/${errorId}`, { method: 'PUT', body: { resolved: true } }); }
  async unresolveError(errorId: number): Promise<AirbrakeError> { return this.client.request<AirbrakeError>(`/groups/${errorId}`, { method: 'PUT', body: { resolved: false } }); }
  async muteError(errorId: number): Promise<AirbrakeError> { return this.client.request<AirbrakeError>(`/groups/${errorId}`, { method: 'PUT', body: { muted: true } }); }
  async deleteError(errorId: number): Promise<void> { await this.client.request(`/groups/${errorId}`, { method: 'DELETE' }); }

  async listNotices(errorId: number, options?: { page?: number }): Promise<AirbrakeNoticeList> {
    return this.client.request<AirbrakeNoticeList>(`/groups/${errorId}/notices`, { params: { page: options?.page } });
  }
  async getNotice(errorId: number, noticeId: string): Promise<AirbrakeNotice> { return this.client.request<AirbrakeNotice>(`/groups/${errorId}/notices/${noticeId}`); }

  async getProject(): Promise<AirbrakeProject> { return this.client.request<AirbrakeProject>(''); }

  async listDeploys(): Promise<AirbrakeDeployList> { return this.client.request<AirbrakeDeployList>('/deploys'); }
  async createDeploy(data: { environment: string; username?: string; repository?: string; revision?: string; version?: string }): Promise<void> {
    await this.client.request('/deploys', { method: 'POST', body: data as Record<string, unknown> });
  }

  getClient(): AirbrakeClient { return this.client; }
}

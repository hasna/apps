// Travis CI Connector — CI/CD for testing and deploying software
import { TravisCIClient } from './client';
import type { TravisCIConfig, TCRepo, TCBuild, TCJob, TCUser } from '../types';
export { TravisCIClient } from './client';

export class TravisCI {
  private readonly client: TravisCIClient;
  constructor(config: TravisCIConfig) { this.client = new TravisCIClient(config); }
  static fromEnv(): TravisCI {
    const token = process.env.TRAVISCI_TOKEN;
    if (!token) throw new Error('TRAVISCI_TOKEN is required');
    return new TravisCI({ token, baseUrl: process.env.TRAVISCI_BASE_URL });
  }

  async getUser(): Promise<TCUser> { return this.client.request<TCUser>('/user'); }

  async listRepos(options?: { limit?: number; offset?: number; active?: boolean }): Promise<{ repositories: TCRepo[] }> {
    return this.client.request('/repos', { params: { limit: options?.limit, offset: options?.offset, active: options?.active === true ? 'true' : undefined } });
  }
  async getRepo(slug: string): Promise<TCRepo> { return this.client.request<TCRepo>(`/repo/${encodeURIComponent(slug)}`); }

  async listBuilds(repoSlug: string, options?: { limit?: number; offset?: number; state?: string }): Promise<{ builds: TCBuild[] }> {
    return this.client.request(`/repo/${encodeURIComponent(repoSlug)}/builds`, { params: { limit: options?.limit, offset: options?.offset, 'state[]': options?.state } });
  }
  async getBuild(buildId: number): Promise<TCBuild> { return this.client.request<TCBuild>(`/build/${buildId}`); }
  async triggerBuild(repoSlug: string, data: { branch?: string; message?: string }): Promise<{ request: { id: number } }> {
    return this.client.request(`/repo/${encodeURIComponent(repoSlug)}/requests`, { method: 'POST', body: { request: { branch: data.branch || 'main', message: data.message } } });
  }
  async cancelBuild(buildId: number): Promise<void> { await this.client.request(`/build/${buildId}/cancel`, { method: 'POST' }); }
  async restartBuild(buildId: number): Promise<void> { await this.client.request(`/build/${buildId}/restart`, { method: 'POST' }); }

  async getJob(jobId: number): Promise<TCJob> { return this.client.request<TCJob>(`/job/${jobId}`); }
  async getJobLog(jobId: number): Promise<{ content: string }> { return this.client.request(`/job/${jobId}/log`); }

  getClient(): TravisCIClient { return this.client; }
}

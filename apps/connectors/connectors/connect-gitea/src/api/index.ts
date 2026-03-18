// Gitea Connector — Self-hosted Git service and DevOps platform
import { GiteaClient } from './client';
import type { GiteaConfig, GiteaRepo, GiteaIssue, GiteaUser, GiteaOrg, GiteaBranch, GiteaPullRequest } from '../types';
export { GiteaClient } from './client';

export class Gitea {
  private readonly client: GiteaClient;
  constructor(config: GiteaConfig) { this.client = new GiteaClient(config); }
  static fromEnv(): Gitea {
    const token = process.env.GITEA_TOKEN;
    const url = process.env.GITEA_URL;
    if (!token || !url) throw new Error('GITEA_TOKEN and GITEA_URL are required');
    return new Gitea({ token, url });
  }

  async getMe(): Promise<GiteaUser> { return this.client.request<GiteaUser>('/user'); }

  async listMyRepos(options?: { page?: number; limit?: number }): Promise<GiteaRepo[]> {
    return this.client.request<GiteaRepo[]>('/user/repos', { params: { page: options?.page, limit: options?.limit } });
  }
  async getRepo(owner: string, repo: string): Promise<GiteaRepo> { return this.client.request<GiteaRepo>(`/repos/${owner}/${repo}`); }
  async createRepo(data: { name: string; description?: string; private?: boolean; auto_init?: boolean }): Promise<GiteaRepo> {
    return this.client.request<GiteaRepo>('/user/repos', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteRepo(owner: string, repo: string): Promise<void> { await this.client.request(`/repos/${owner}/${repo}`, { method: 'DELETE' }); }

  async listIssues(owner: string, repo: string, options?: { state?: string; page?: number; limit?: number }): Promise<GiteaIssue[]> {
    return this.client.request<GiteaIssue[]>(`/repos/${owner}/${repo}/issues`, { params: { state: options?.state, page: options?.page, limit: options?.limit } });
  }
  async getIssue(owner: string, repo: string, index: number): Promise<GiteaIssue> { return this.client.request<GiteaIssue>(`/repos/${owner}/${repo}/issues/${index}`); }
  async createIssue(owner: string, repo: string, data: { title: string; body?: string; assignees?: string[]; labels?: number[] }): Promise<GiteaIssue> {
    return this.client.request<GiteaIssue>(`/repos/${owner}/${repo}/issues`, { method: 'POST', body: data as Record<string, unknown> });
  }

  async listBranches(owner: string, repo: string): Promise<GiteaBranch[]> { return this.client.request<GiteaBranch[]>(`/repos/${owner}/${repo}/branches`); }

  async listPullRequests(owner: string, repo: string, options?: { state?: string; page?: number }): Promise<GiteaPullRequest[]> {
    return this.client.request<GiteaPullRequest[]>(`/repos/${owner}/${repo}/pulls`, { params: { state: options?.state, page: options?.page } });
  }
  async createPullRequest(owner: string, repo: string, data: { title: string; body?: string; head: string; base: string }): Promise<GiteaPullRequest> {
    return this.client.request<GiteaPullRequest>(`/repos/${owner}/${repo}/pulls`, { method: 'POST', body: data as Record<string, unknown> });
  }

  async listOrgs(): Promise<GiteaOrg[]> { return this.client.request<GiteaOrg[]>('/user/orgs'); }

  getClient(): GiteaClient { return this.client; }
}

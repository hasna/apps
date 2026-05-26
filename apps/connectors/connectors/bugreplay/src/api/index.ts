// BugReplay Connector — Screen recording and bug reporting for QA
import { BugReplayClient } from './client';
import type { BugReplayConfig, BRBug, BRBugList, BRProject, BRComment } from '../types';
export { BugReplayClient } from './client';

export class BugReplay {
  private readonly client: BugReplayClient;
  constructor(config: BugReplayConfig) { this.client = new BugReplayClient(config); }
  static fromEnv(): BugReplay {
    const apiKey = process.env.BUGREPLAY_API_KEY;
    if (!apiKey) throw new Error('BUGREPLAY_API_KEY is required');
    return new BugReplay({ apiKey });
  }

  async listProjects(): Promise<BRProject[]> { return this.client.request<BRProject[]>('/projects'); }
  async getProject(projectId: string): Promise<BRProject> { return this.client.request<BRProject>(`/projects/${projectId}`); }

  async listBugs(projectId: string, options?: { page?: number; per_page?: number; status?: string }): Promise<BRBugList> {
    return this.client.request<BRBugList>(`/projects/${projectId}/bugs`, { params: { page: options?.page, per_page: options?.per_page, status: options?.status } });
  }
  async getBug(bugId: string): Promise<BRBug> { return this.client.request<BRBug>(`/bugs/${bugId}`); }
  async updateBug(bugId: string, data: { status?: string; priority?: string; assignee_id?: string }): Promise<BRBug> {
    return this.client.request<BRBug>(`/bugs/${bugId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }

  async listComments(bugId: string): Promise<BRComment[]> { return this.client.request<BRComment[]>(`/bugs/${bugId}/comments`); }
  async addComment(bugId: string, body: string): Promise<BRComment> {
    return this.client.request<BRComment>(`/bugs/${bugId}/comments`, { method: 'POST', body: { body } });
  }

  getClient(): BugReplayClient { return this.client; }
}

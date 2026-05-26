// Yodiz Connector — Agile project management and issue tracking
import { YodizClient } from './client';
import type { YodizConfig, YZProject, YZUserStory, YZIssue, YZSprint, YZComment } from '../types';
export { YodizClient } from './client';

export class Yodiz {
  private readonly client: YodizClient;
  constructor(config: YodizConfig) { this.client = new YodizClient(config); }
  static fromEnv(): Yodiz {
    const apiKey = process.env.YODIZ_API_KEY;
    const apiToken = process.env.YODIZ_API_TOKEN;
    if (!apiKey || !apiToken) throw new Error('YODIZ_API_KEY and YODIZ_API_TOKEN are required');
    return new Yodiz({ apiKey, apiToken });
  }

  async listProjects(): Promise<YZProject[]> { return this.client.request<YZProject[]>('/projects'); }
  async getProject(projectId: number): Promise<YZProject> { return this.client.request<YZProject>(`/projects/${projectId}`); }

  async listUserStories(projectId: number, options?: { sprint_id?: number; status_id?: number }): Promise<YZUserStory[]> {
    return this.client.request<YZUserStory[]>(`/projects/${projectId}/userstories`, { params: { sprint_id: options?.sprint_id, status_id: options?.status_id } });
  }
  async getUserStory(projectId: number, storyId: number): Promise<YZUserStory> {
    return this.client.request<YZUserStory>(`/projects/${projectId}/userstories/${storyId}`);
  }
  async createUserStory(projectId: number, data: { title: string; description?: string; priority_id?: number; sprint_id?: number; assigned_to_id?: number; story_points?: number }): Promise<YZUserStory> {
    return this.client.request<YZUserStory>(`/projects/${projectId}/userstories`, { method: 'POST', body: data as Record<string, unknown> });
  }

  async listIssues(projectId: number, options?: { status_id?: number; type_id?: number }): Promise<YZIssue[]> {
    return this.client.request<YZIssue[]>(`/projects/${projectId}/issues`, { params: { status_id: options?.status_id, type_id: options?.type_id } });
  }
  async createIssue(projectId: number, data: { title: string; description?: string; priority_id?: number; type_id?: number; assigned_to_id?: number }): Promise<YZIssue> {
    return this.client.request<YZIssue>(`/projects/${projectId}/issues`, { method: 'POST', body: data as Record<string, unknown> });
  }

  async listSprints(projectId: number): Promise<YZSprint[]> { return this.client.request<YZSprint[]>(`/projects/${projectId}/sprints`); }

  async listComments(entityType: string, entityId: number): Promise<YZComment[]> {
    return this.client.request<YZComment[]>(`/${entityType}/${entityId}/comments`);
  }
  async addComment(entityType: string, entityId: number, text: string): Promise<YZComment> {
    return this.client.request<YZComment>(`/${entityType}/${entityId}/comments`, { method: 'POST', body: { text } });
  }

  getClient(): YodizClient { return this.client; }
}

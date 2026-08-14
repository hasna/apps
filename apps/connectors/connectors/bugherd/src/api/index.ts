// BugHerd Connector — Visual bug tracking and website feedback
import { BugHerdClient } from './client';
import type { BugHerdConfig, BHProject, BHTask, BHTaskList, BHComment, BHWebhook } from '../types';
export { BugHerdClient } from './client';

export class BugHerd {
  private readonly client: BugHerdClient;
  constructor(config: BugHerdConfig) { this.client = new BugHerdClient(config); }
  static fromEnv(): BugHerd {
    const apiKey = process.env.BUGHERD_API_KEY;
    if (!apiKey) throw new Error('BUGHERD_API_KEY is required');
    return new BugHerd({ apiKey });
  }

  async listProjects(): Promise<{ projects: BHProject[] }> { return this.client.request('/projects'); }
  async getProject(projectId: number): Promise<{ project: BHProject }> { return this.client.request(`/projects/${projectId}`); }

  async listTasks(projectId: number, options?: { page?: number; status?: string }): Promise<BHTaskList> {
    return this.client.request<BHTaskList>(`/projects/${projectId}/tasks`, { params: { page: options?.page, status: options?.status } });
  }
  async getTask(projectId: number, taskId: number): Promise<{ task: BHTask }> {
    return this.client.request(`/projects/${projectId}/tasks/${taskId}`);
  }
  async createTask(projectId: number, data: { description: string; priority_id?: number; status_id?: number; assignee_id?: number; tag_names?: string[] }): Promise<{ task: BHTask }> {
    return this.client.request(`/projects/${projectId}/tasks`, { method: 'POST', body: { task: data } });
  }
  async updateTask(projectId: number, taskId: number, data: { description?: string; priority_id?: number; status_id?: number; assignee_id?: number }): Promise<{ task: BHTask }> {
    return this.client.request(`/projects/${projectId}/tasks/${taskId}`, { method: 'PUT', body: { task: data } });
  }

  async listComments(projectId: number, taskId: number): Promise<{ comments: BHComment[] }> {
    return this.client.request(`/projects/${projectId}/tasks/${taskId}/comments`);
  }
  async createComment(projectId: number, taskId: number, text: string): Promise<{ comment: BHComment }> {
    return this.client.request(`/projects/${projectId}/tasks/${taskId}/comments`, { method: 'POST', body: { comment: { text } } });
  }

  async listWebhooks(projectId: number): Promise<{ webhooks: BHWebhook[] }> { return this.client.request(`/projects/${projectId}/webhooks`); }

  getClient(): BugHerdClient { return this.client; }
}

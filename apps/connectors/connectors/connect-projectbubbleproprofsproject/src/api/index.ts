// ProProfs Project Connector — Project management and task tracking
import { ProProfsProjectClient } from './client';
import type { ProProfsProjectConfig, PPProject, PPTask, PPTaskList, PPMember, PPTimeLog } from '../types';
export { ProProfsProjectClient } from './client';

export class ProProfsProject {
  private readonly client: ProProfsProjectClient;
  constructor(config: ProProfsProjectConfig) { this.client = new ProProfsProjectClient(config); }
  static fromEnv(): ProProfsProject {
    const apiKey = process.env.PROPROFSPROJECT_API_KEY;
    if (!apiKey) throw new Error('PROPROFSPROJECT_API_KEY is required');
    return new ProProfsProject({ apiKey });
  }

  async listProjects(): Promise<PPProject[]> { return this.client.request<PPProject[]>('/projects'); }
  async getProject(projectId: string): Promise<PPProject> { return this.client.request<PPProject>(`/projects/${projectId}`); }
  async createProject(data: { name: string; description?: string; start_date?: string; end_date?: string }): Promise<PPProject> {
    return this.client.request<PPProject>('/projects', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listTasks(projectId: string, options?: { page?: number; per_page?: number; status?: string; assignee_id?: string }): Promise<PPTaskList> {
    return this.client.request<PPTaskList>(`/projects/${projectId}/tasks`, { params: { page: options?.page, per_page: options?.per_page, status: options?.status, assignee_id: options?.assignee_id } });
  }
  async getTask(projectId: string, taskId: string): Promise<PPTask> { return this.client.request<PPTask>(`/projects/${projectId}/tasks/${taskId}`); }
  async createTask(projectId: string, data: { title: string; description?: string; priority?: string; assignee_id?: string; due_date?: string }): Promise<PPTask> {
    return this.client.request<PPTask>(`/projects/${projectId}/tasks`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateTask(projectId: string, taskId: string, data: { title?: string; status?: string; priority?: string; assignee_id?: string }): Promise<PPTask> {
    return this.client.request<PPTask>(`/projects/${projectId}/tasks/${taskId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteTask(projectId: string, taskId: string): Promise<void> { await this.client.request(`/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' }); }

  async listMembers(projectId: string): Promise<PPMember[]> { return this.client.request<PPMember[]>(`/projects/${projectId}/members`); }

  async logTime(projectId: string, taskId: string, data: { hours: number; description?: string; date?: string }): Promise<PPTimeLog> {
    return this.client.request<PPTimeLog>(`/projects/${projectId}/tasks/${taskId}/timelogs`, { method: 'POST', body: data as Record<string, unknown> });
  }

  getClient(): ProProfsProjectClient { return this.client; }
}

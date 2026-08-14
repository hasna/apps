// Microsoft To Do Connector — Task management via Microsoft Graph
import { MSTodoClient } from './client';
import type { MSTodoConfig, MTTaskList, MTTask, MTChecklistItem } from '../types';
export { MSTodoClient } from './client';

export class MSTodo {
  private readonly client: MSTodoClient;
  constructor(config: MSTodoConfig) { this.client = new MSTodoClient(config); }
  static fromEnv(): MSTodo {
    const token = process.env.MSTODO_TOKEN;
    if (!token) throw new Error('MSTODO_TOKEN is required');
    return new MSTodo({ token });
  }

  async listTaskLists(): Promise<{ value: MTTaskList[] }> { return this.client.request('/lists'); }
  async getTaskList(listId: string): Promise<MTTaskList> { return this.client.request<MTTaskList>(`/lists/${listId}`); }
  async createTaskList(displayName: string): Promise<MTTaskList> {
    return this.client.request<MTTaskList>('/lists', { method: 'POST', body: { displayName } });
  }
  async deleteTaskList(listId: string): Promise<void> { await this.client.request(`/lists/${listId}`, { method: 'DELETE' }); }

  async listTasks(listId: string): Promise<{ value: MTTask[] }> { return this.client.request(`/lists/${listId}/tasks`); }
  async getTask(listId: string, taskId: string): Promise<MTTask> { return this.client.request<MTTask>(`/lists/${listId}/tasks/${taskId}`); }
  async createTask(listId: string, data: { title: string; body?: { content: string; contentType?: string }; importance?: string; dueDateTime?: { dateTime: string; timeZone: string } }): Promise<MTTask> {
    return this.client.request<MTTask>(`/lists/${listId}/tasks`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateTask(listId: string, taskId: string, data: { title?: string; status?: string; importance?: string }): Promise<MTTask> {
    return this.client.request<MTTask>(`/lists/${listId}/tasks/${taskId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async completeTask(listId: string, taskId: string): Promise<MTTask> {
    return this.updateTask(listId, taskId, { status: 'completed' });
  }
  async deleteTask(listId: string, taskId: string): Promise<void> { await this.client.request(`/lists/${listId}/tasks/${taskId}`, { method: 'DELETE' }); }

  async listChecklistItems(listId: string, taskId: string): Promise<{ value: MTChecklistItem[] }> {
    return this.client.request(`/lists/${listId}/tasks/${taskId}/checklistItems`);
  }
  async createChecklistItem(listId: string, taskId: string, displayName: string): Promise<MTChecklistItem> {
    return this.client.request<MTChecklistItem>(`/lists/${listId}/tasks/${taskId}/checklistItems`, { method: 'POST', body: { displayName } });
  }

  getClient(): MSTodoClient { return this.client; }
}

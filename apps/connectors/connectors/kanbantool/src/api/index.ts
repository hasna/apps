// Kanban Tool Connector — Visual project management with Kanban boards
import { KanbanToolClient } from './client';
import type { KanbanToolConfig, KTBoard, KTTask, KTUser, KTComment } from '../types';
export { KanbanToolClient } from './client';

export class KanbanTool {
  private readonly client: KanbanToolClient;
  constructor(config: KanbanToolConfig) { this.client = new KanbanToolClient(config); }
  static fromEnv(): KanbanTool {
    const domain = process.env.KANBANTOOL_DOMAIN;
    const apiToken = process.env.KANBANTOOL_API_TOKEN;
    if (!domain || !apiToken) throw new Error('KANBANTOOL_DOMAIN and KANBANTOOL_API_TOKEN are required');
    return new KanbanTool({ domain, apiToken });
  }

  async listBoards(): Promise<KTBoard[]> { return this.client.request<KTBoard[]>('/boards'); }
  async getBoard(boardId: number): Promise<KTBoard> { return this.client.request<KTBoard>(`/boards/${boardId}`); }

  async listTasks(boardId: number, options?: { column_id?: number }): Promise<KTTask[]> {
    return this.client.request<KTTask[]>(`/boards/${boardId}/tasks`, { params: { column_id: options?.column_id } });
  }
  async getTask(boardId: number, taskId: number): Promise<KTTask> { return this.client.request<KTTask>(`/boards/${boardId}/tasks/${taskId}`); }
  async createTask(boardId: number, data: { name: string; column_id: number; description?: string; color?: string; priority?: number; assignee_ids?: number[]; due_date?: string }): Promise<KTTask> {
    return this.client.request<KTTask>(`/boards/${boardId}/tasks`, { method: 'POST', body: { task: data } as Record<string, unknown> });
  }
  async updateTask(boardId: number, taskId: number, data: { name?: string; column_id?: number; description?: string; priority?: number }): Promise<KTTask> {
    return this.client.request<KTTask>(`/boards/${boardId}/tasks/${taskId}`, { method: 'PUT', body: { task: data } as Record<string, unknown> });
  }
  async deleteTask(boardId: number, taskId: number): Promise<void> { await this.client.request(`/boards/${boardId}/tasks/${taskId}`, { method: 'DELETE' }); }
  async moveTask(boardId: number, taskId: number, columnId: number, position?: number): Promise<KTTask> {
    return this.client.request<KTTask>(`/boards/${boardId}/tasks/${taskId}/move`, { method: 'PUT', body: { column_id: columnId, position } as Record<string, unknown> });
  }

  async listComments(boardId: number, taskId: number): Promise<KTComment[]> { return this.client.request<KTComment[]>(`/boards/${boardId}/tasks/${taskId}/comments`); }
  async addComment(boardId: number, taskId: number, body: string): Promise<KTComment> {
    return this.client.request<KTComment>(`/boards/${boardId}/tasks/${taskId}/comments`, { method: 'POST', body: { comment: { body } } });
  }

  async listUsers(): Promise<KTUser[]> { return this.client.request<KTUser[]>('/users'); }

  getClient(): KanbanToolClient { return this.client; }
}

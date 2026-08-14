// VivifyScrum Connector — Agile project management with Scrum and Kanban
import { VivifyScrumClient } from './client';
import type { VivifyScrumConfig, VSBoard, VSItem, VSItemList, VSSprint, VSMember } from '../types';
export { VivifyScrumClient } from './client';

export class VivifyScrum {
  private readonly client: VivifyScrumClient;
  constructor(config: VivifyScrumConfig) { this.client = new VivifyScrumClient(config); }
  static fromEnv(): VivifyScrum {
    const token = process.env.VIVIFYSCRUM_TOKEN;
    if (!token) throw new Error('VIVIFYSCRUM_TOKEN is required');
    return new VivifyScrum({ token });
  }

  async listBoards(): Promise<VSBoard[]> { return this.client.request<VSBoard[]>('/boards'); }
  async getBoard(boardId: number): Promise<VSBoard> { return this.client.request<VSBoard>(`/boards/${boardId}`); }

  async listItems(boardId: number, options?: { page?: number; per_page?: number; column_id?: number; type?: string }): Promise<VSItemList> {
    return this.client.request<VSItemList>(`/boards/${boardId}/items`, { params: { page: options?.page, per_page: options?.per_page, column_id: options?.column_id, type: options?.type } });
  }
  async getItem(boardId: number, itemId: number): Promise<VSItem> { return this.client.request<VSItem>(`/boards/${boardId}/items/${itemId}`); }
  async createItem(boardId: number, data: { title: string; column_id: number; type?: string; priority?: string; description?: string; assignee_id?: number; story_points?: number }): Promise<VSItem> {
    return this.client.request<VSItem>(`/boards/${boardId}/items`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateItem(boardId: number, itemId: number, data: { title?: string; column_id?: number; priority?: string; assignee_id?: number; story_points?: number }): Promise<VSItem> {
    return this.client.request<VSItem>(`/boards/${boardId}/items/${itemId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteItem(boardId: number, itemId: number): Promise<void> { await this.client.request(`/boards/${boardId}/items/${itemId}`, { method: 'DELETE' }); }

  async listSprints(boardId: number): Promise<VSSprint[]> { return this.client.request<VSSprint[]>(`/boards/${boardId}/sprints`); }

  async listMembers(boardId: number): Promise<VSMember[]> { return this.client.request<VSMember[]>(`/boards/${boardId}/members`); }

  getClient(): VivifyScrumClient { return this.client; }
}

// Miro Connector — Visual collaboration and whiteboarding
import { MiroClient } from './client';
import type { MiroConfig, MRBoard, MRBoardList, MRItem, MRItemList, MRStickyNote, MRConnector } from '../types';
export { MiroClient } from './client';

export class Miro {
  private readonly client: MiroClient;
  constructor(config: MiroConfig) { this.client = new MiroClient(config); }
  static fromEnv(): Miro {
    const token = process.env.MIRO_TOKEN;
    if (!token) throw new Error('MIRO_TOKEN is required');
    return new Miro({ token });
  }

  async listBoards(options?: { limit?: number; offset?: number; query?: string }): Promise<MRBoardList> {
    return this.client.request<MRBoardList>('/boards', { params: { limit: options?.limit, offset: options?.offset, query: options?.query } });
  }
  async getBoard(boardId: string): Promise<MRBoard> { return this.client.request<MRBoard>(`/boards/${boardId}`); }
  async createBoard(data: { name: string; description?: string; teamId?: string }): Promise<MRBoard> {
    return this.client.request<MRBoard>('/boards', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listItems(boardId: string, options?: { limit?: number; cursor?: string; type?: string }): Promise<MRItemList> {
    return this.client.request<MRItemList>(`/boards/${boardId}/items`, { params: { limit: options?.limit, cursor: options?.cursor, type: options?.type } });
  }
  async getItem(boardId: string, itemId: string): Promise<MRItem> { return this.client.request<MRItem>(`/boards/${boardId}/items/${itemId}`); }
  async deleteItem(boardId: string, itemId: string): Promise<void> { await this.client.request(`/boards/${boardId}/items/${itemId}`, { method: 'DELETE' }); }

  async createStickyNote(boardId: string, data: { content: string; shape?: string; fillColor?: string; x?: number; y?: number }): Promise<MRStickyNote> {
    return this.client.request<MRStickyNote>(`/boards/${boardId}/sticky_notes`, { method: 'POST', body: { data: { content: data.content, shape: data.shape }, style: { fillColor: data.fillColor }, position: { x: data.x || 0, y: data.y || 0 } } });
  }

  async createConnector(boardId: string, startItemId: string, endItemId: string): Promise<MRConnector> {
    return this.client.request<MRConnector>(`/boards/${boardId}/connectors`, { method: 'POST', body: { startItem: { id: startItemId }, endItem: { id: endItemId } } });
  }

  async listMembers(boardId: string): Promise<{ data: { id: string; name: string; role: string }[] }> {
    return this.client.request(`/boards/${boardId}/members`);
  }

  getClient(): MiroClient { return this.client; }
}

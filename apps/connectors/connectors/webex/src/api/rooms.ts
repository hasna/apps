import type { WebexClient } from './client';
import type {
  PaginatedResponse,
  WebexRoom,
  WebexRoomCreateRequest,
  WebexRoomUpdateRequest,
  ListRoomsOptions,
} from '../types';

export class RoomsApi {
  constructor(private readonly client: WebexClient) {}

  async list(options: ListRoomsOptions = {}): Promise<WebexRoom[]> {
    const response = await this.client.get<PaginatedResponse<WebexRoom>>('/rooms', {
      type: options.type,
      sortBy: options.sortBy,
      max: options.max,
    });
    return response.items ?? [];
  }

  async get(roomId: string): Promise<WebexRoom> {
    return this.client.get<WebexRoom>(`/rooms/${encodeURIComponent(roomId)}`);
  }

  async create(room: WebexRoomCreateRequest): Promise<WebexRoom> {
    return this.client.post<WebexRoom>('/rooms', room);
  }

  async update(roomId: string, updates: WebexRoomUpdateRequest): Promise<WebexRoom> {
    return this.client.put<WebexRoom>(`/rooms/${encodeURIComponent(roomId)}`, updates);
  }

  async delete(roomId: string): Promise<void> {
    await this.client.delete(`/rooms/${encodeURIComponent(roomId)}`);
  }
}

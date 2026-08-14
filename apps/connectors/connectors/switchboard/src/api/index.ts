// Switchboard Connector — Collaborative canvas for async team meetings
import { SwitchboardClient } from './client';
import type { SwitchboardConfig, SWRoom, SWRoomList, SWApp, SWParticipant } from '../types';
export { SwitchboardClient } from './client';

export class Switchboard {
  private readonly client: SwitchboardClient;
  constructor(config: SwitchboardConfig) { this.client = new SwitchboardClient(config); }
  static fromEnv(): Switchboard {
    const apiKey = process.env.SWITCHBOARD_API_KEY;
    if (!apiKey) throw new Error('SWITCHBOARD_API_KEY is required');
    return new Switchboard({ apiKey });
  }

  async listRooms(options?: { page?: number; status?: string }): Promise<SWRoomList> {
    return this.client.request<SWRoomList>('/rooms', { params: { page: options?.page, status: options?.status } });
  }
  async getRoom(roomId: string): Promise<SWRoom> { return this.client.request<SWRoom>(`/rooms/${roomId}`); }
  async createRoom(data: { name: string; description?: string }): Promise<SWRoom> {
    return this.client.request<SWRoom>('/rooms', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteRoom(roomId: string): Promise<void> { await this.client.request(`/rooms/${roomId}`, { method: 'DELETE' }); }

  async listApps(roomId: string): Promise<SWApp[]> { return this.client.request<SWApp[]>(`/rooms/${roomId}/apps`); }
  async addApp(roomId: string, data: { name: string; type: string; url: string }): Promise<SWApp> {
    return this.client.request<SWApp>(`/rooms/${roomId}/apps`, { method: 'POST', body: data as Record<string, unknown> });
  }

  async listParticipants(roomId: string): Promise<SWParticipant[]> { return this.client.request<SWParticipant[]>(`/rooms/${roomId}/participants`); }
  async inviteParticipant(roomId: string, email: string, role?: string): Promise<void> {
    await this.client.request(`/rooms/${roomId}/participants`, { method: 'POST', body: { email, role: role || 'member' } });
  }

  getClient(): SwitchboardClient { return this.client; }
}

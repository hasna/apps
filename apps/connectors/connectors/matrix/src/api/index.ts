// Matrix Connector — Open network for decentralized communication
import { MatrixClient } from './client';
import type { MatrixConfig, MXRoom, MXEvent, MXSync, MXUser, MXRoomMessages } from '../types';
export { MatrixClient } from './client';

export class Matrix {
  private readonly client: MatrixClient;
  constructor(config: MatrixConfig) { this.client = new MatrixClient(config); }
  static fromEnv(): Matrix {
    const homeserver = process.env.MATRIX_HOMESERVER;
    const accessToken = process.env.MATRIX_ACCESS_TOKEN;
    if (!homeserver || !accessToken) throw new Error('MATRIX_HOMESERVER and MATRIX_ACCESS_TOKEN are required');
    return new Matrix({ homeserver, accessToken });
  }

  async whoami(): Promise<{ user_id: string }> { return this.client.request('/account/whoami'); }
  async getProfile(userId: string): Promise<MXUser> { return this.client.request<MXUser>(`/profile/${userId}`); }

  async listJoinedRooms(): Promise<{ joined_rooms: string[] }> { return this.client.request('/joined_rooms'); }
  async getRoomState(roomId: string): Promise<MXEvent[]> { return this.client.request<MXEvent[]>(`/rooms/${roomId}/state`); }
  async getRoomMessages(roomId: string, options?: { from?: string; dir?: 'b' | 'f'; limit?: number }): Promise<MXRoomMessages> {
    return this.client.request<MXRoomMessages>(`/rooms/${roomId}/messages`, { params: { from: options?.from, dir: options?.dir || 'b', limit: options?.limit } });
  }
  async getRoomMembers(roomId: string): Promise<{ chunk: MXEvent[] }> { return this.client.request(`/rooms/${roomId}/members`); }

  async sendMessage(roomId: string, body: string, options?: { msgtype?: string; format?: string; formatted_body?: string }): Promise<{ event_id: string }> {
    const txnId = `m${Date.now()}`;
    return this.client.request(`/rooms/${roomId}/send/m.room.message/${txnId}`, { method: 'PUT', body: { msgtype: options?.msgtype || 'm.text', body, format: options?.format, formatted_body: options?.formatted_body } });
  }

  async joinRoom(roomIdOrAlias: string): Promise<{ room_id: string }> {
    return this.client.request(`/join/${encodeURIComponent(roomIdOrAlias)}`, { method: 'POST' });
  }
  async leaveRoom(roomId: string): Promise<void> { await this.client.request(`/rooms/${roomId}/leave`, { method: 'POST' }); }
  async createRoom(data: { name?: string; topic?: string; visibility?: 'public' | 'private'; invite?: string[] }): Promise<{ room_id: string }> {
    return this.client.request('/createRoom', { method: 'POST', body: data as Record<string, unknown> });
  }

  async sync(options?: { since?: string; timeout?: number; filter?: string }): Promise<MXSync> {
    return this.client.request<MXSync>('/sync', { params: { since: options?.since, timeout: options?.timeout, filter: options?.filter } });
  }

  getClient(): MatrixClient { return this.client; }
}

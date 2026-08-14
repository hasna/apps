import type { BrowserUseClient } from './client';
import type {
  Session,
  CreateSessionParams,
  ListSessionsParams,
  SessionPublicShare,
  PaginatedResponse,
} from '../types';

/**
 * Sessions API
 */
export class SessionsApi {
  constructor(private client: BrowserUseClient) {}

  /**
   * List all sessions
   */
  async list(params?: ListSessionsParams): Promise<PaginatedResponse<Session>> {
    return this.client.get<PaginatedResponse<Session>>('/v2/sessions', {
      limit: params?.limit,
      cursor: params?.cursor,
      status: params?.status,
    });
  }

  /**
   * Create a new session
   */
  async create(params?: CreateSessionParams): Promise<Session> {
    return this.client.post<Session>('/v2/sessions', {
      task: params?.task,
      profile_id: params?.profileId,
      proxy_url: params?.proxyUrl,
      keep_alive: params?.keepAlive,
      save_browser_data: params?.save_browser_data,
    });
  }

  /**
   * Get a session by ID
   */
  async get(sessionId: string): Promise<Session> {
    return this.client.get<Session>(`/v2/sessions/${sessionId}`);
  }

  /**
   * Update a session (stop)
   */
  async update(sessionId: string, action: 'stop'): Promise<Session> {
    return this.client.patch<Session>(`/v2/sessions/${sessionId}`, { action });
  }

  /**
   * Stop a session
   */
  async stop(sessionId: string): Promise<Session> {
    return this.update(sessionId, 'stop');
  }

  /**
   * Delete a session
   */
  async delete(sessionId: string): Promise<void> {
    await this.client.delete(`/v2/sessions/${sessionId}`);
  }

  /**
   * Get public share for a session
   */
  async getPublicShare(sessionId: string): Promise<SessionPublicShare> {
    return this.client.get<SessionPublicShare>(`/v2/sessions/${sessionId}/public-share`);
  }

  /**
   * Create public share for a session
   */
  async createPublicShare(sessionId: string): Promise<SessionPublicShare> {
    return this.client.post<SessionPublicShare>(`/v2/sessions/${sessionId}/public-share`);
  }

  /**
   * Delete public share for a session
   */
  async deletePublicShare(sessionId: string): Promise<void> {
    await this.client.delete(`/v2/sessions/${sessionId}/public-share`);
  }
}

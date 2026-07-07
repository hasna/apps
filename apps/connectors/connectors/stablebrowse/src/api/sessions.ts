import type { StableBrowseClient } from './client';
import type { Session } from '../types';

/**
 * Sessions API
 */
export class SessionsApi {
  constructor(private client: StableBrowseClient) {}

  /**
   * Get a session by ID, including all tasks ordered by createdAt ascending.
   */
  async get(sessionId: string): Promise<Session> {
    return this.client.get<Session>(`/sessions/${encodeURIComponent(sessionId)}`);
  }
}

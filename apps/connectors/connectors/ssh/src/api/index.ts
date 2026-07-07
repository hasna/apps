import { SshClient } from './client';
import type {
  SshConfig,
  SshEventList,
  SshSearchRequest,
  SshSearchResponse,
  SshSession,
  SshSessionList,
  HttpMethod,
} from '../types';

export { SshClient, DEFAULT_BASE_URL } from './client';
export type { RequestOptions } from './client';

export class Ssh {
  private readonly client: SshClient;

  constructor(config: SshConfig) {
    this.client = new SshClient(config);
  }

  static fromEnv(): Ssh {
    const apiKey = process.env.SSH_API_KEY;
    if (!apiKey) throw new Error('SSH_API_KEY is required');
    return new Ssh({
      apiKey,
      baseUrl: process.env.SSH_BASE_URL,
    });
  }

  async listSessions(params?: Record<string, string | number | boolean | undefined>): Promise<SshSessionList> {
    return this.client.request<SshSessionList>('/sessions', { params });
  }

  async createSession(body?: Record<string, unknown>): Promise<SshSession> {
    return this.client.request<SshSession>('/sessions', { method: 'POST', body: body ?? {} });
  }

  async getSession(sessionId: string): Promise<SshSession> {
    return this.client.request<SshSession>(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<SshEventList> {
    return this.client.request<SshEventList>('/events', { params });
  }

  async search(body: SshSearchRequest): Promise<SshSearchResponse> {
    return this.client.request<SshSearchResponse>('/search', { method: 'POST', body });
  }

  async rawRequest<T = unknown>(
    path: string,
    method: HttpMethod = 'GET',
    body?: Record<string, unknown> | unknown[],
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.client.request<T>(path, { method, body, params });
  }

  getClient(): SshClient {
    return this.client;
  }
}

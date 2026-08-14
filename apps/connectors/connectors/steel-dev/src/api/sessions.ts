import type {
  CreateSessionRequest,
  ScrapeRequest,
  ScrapeResponse,
  Session,
  SessionEventsResponse,
  SessionListResponse,
} from '../types';
import { SteelDevClient } from './client';

export class SessionsApi {
  constructor(private readonly client: SteelDevClient) {}

  async list(): Promise<SessionListResponse> {
    return this.client.get<SessionListResponse>('/sessions');
  }

  async create(body: CreateSessionRequest = {}): Promise<Session> {
    return this.client.post<Session>('/sessions', body);
  }

  async get(sessionId: string): Promise<Session> {
    return this.client.get<Session>(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  async release(sessionId: string): Promise<unknown> {
    return this.client.post(`/sessions/${encodeURIComponent(sessionId)}/release`);
  }

  async events(sessionId: string): Promise<SessionEventsResponse> {
    return this.client.get<SessionEventsResponse>(`/sessions/${encodeURIComponent(sessionId)}/events`);
  }
}

export class SearchApi {
  constructor(private readonly client: SteelDevClient) {}

  /**
   * Scrape a URL and return rendered page content (markdown, html, etc.).
   * Maps to POST /v1/scrape — Steel's stateless page extraction endpoint.
   */
  async scrape(body: ScrapeRequest): Promise<ScrapeResponse> {
    return this.client.post<ScrapeResponse>('/scrape', body);
  }
}

// Sidekick (Textsidekick) — SMS frontline assistant API
import { TextsidekickClient } from './client';
import type {
  ListResponse,
  SidekickDocument,
  SidekickEscalation,
  SidekickMessage,
  SidekickPhoneNumber,
  SidekickTutorial,
  SidekickWorker,
  TextsidekickConfig,
} from '../types';

export { TextsidekickClient, DEFAULT_BASE_URL } from './client';

export class Sidekick {
  private readonly client: TextsidekickClient;

  constructor(config: TextsidekickConfig) {
    this.client = new TextsidekickClient(config);
  }

  static fromEnv(): Sidekick {
    const apiKey = process.env.TEXTSIDEKICK_API_KEY;
    if (!apiKey) throw new Error('TEXTSIDEKICK_API_KEY is required');
    return new Sidekick({
      apiKey,
      baseUrl: process.env.TEXTSIDEKICK_BASE_URL,
    });
  }

  async listDocuments(params?: Record<string, string | number | undefined>): Promise<ListResponse<SidekickDocument>> {
    return this.client.request('/documents', { params });
  }

  async getDocument(documentId: string): Promise<SidekickDocument> {
    return this.client.request(`/documents/${encodeURIComponent(documentId)}`);
  }

  async uploadDocument(body: Record<string, unknown>): Promise<SidekickDocument> {
    return this.client.request('/documents', { method: 'POST', body });
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.client.request(`/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
  }

  async listWorkers(params?: Record<string, string | number | undefined>): Promise<ListResponse<SidekickWorker>> {
    return this.client.request('/workers', { params });
  }

  async getWorker(workerId: string): Promise<SidekickWorker> {
    return this.client.request(`/workers/${encodeURIComponent(workerId)}`);
  }

  async createWorker(body: Record<string, unknown>): Promise<SidekickWorker> {
    return this.client.request('/workers', { method: 'POST', body });
  }

  async listMessages(params?: Record<string, string | number | undefined>): Promise<ListResponse<SidekickMessage>> {
    return this.client.request('/messages', { params });
  }

  async sendMessage(body: Record<string, unknown>): Promise<SidekickMessage> {
    return this.client.request('/messages', { method: 'POST', body });
  }

  async listEscalations(params?: Record<string, string | number | undefined>): Promise<ListResponse<SidekickEscalation>> {
    return this.client.request('/escalations', { params });
  }

  async resolveEscalation(escalationId: string, body: Record<string, unknown> = {}): Promise<SidekickEscalation> {
    return this.client.request(`/escalations/${encodeURIComponent(escalationId)}/resolve`, {
      method: 'POST',
      body,
    });
  }

  async listTutorials(params?: Record<string, string | number | undefined>): Promise<ListResponse<SidekickTutorial>> {
    return this.client.request('/tutorials', { params });
  }

  async getTutorial(tutorialId: string): Promise<SidekickTutorial> {
    return this.client.request(`/tutorials/${encodeURIComponent(tutorialId)}`);
  }

  async getPhoneNumber(params?: Record<string, string | number | undefined>): Promise<SidekickPhoneNumber> {
    return this.client.request('/phone-number', { params });
  }

  async rawRequest(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<unknown> {
    return this.client.request(path.startsWith('/') ? path : `/${path}`, options);
  }

  getClient(): TextsidekickClient {
    return this.client;
  }
}

// Airtop Connector — Cloud browser automation and AI web scraping
import { AirtopClient } from './client';
import type { AirtopConfig, AirtopSession, AirtopSessionList, AirtopWindow, AirtopScrapeResult, AirtopPromptResult, AirtopScreenshot } from '../types';
export { AirtopClient } from './client';

export class Airtop {
  private readonly client: AirtopClient;
  constructor(config: AirtopConfig) { this.client = new AirtopClient(config); }
  static fromEnv(): Airtop {
    const apiKey = process.env.AIRTOP_API_KEY;
    if (!apiKey) throw new Error('AIRTOP_API_KEY is required');
    return new Airtop({ apiKey });
  }

  async createSession(options?: { configuration?: Record<string, unknown> }): Promise<AirtopSession> {
    return this.client.request<AirtopSession>('/sessions', { method: 'POST', body: options?.configuration ? { configuration: options.configuration } : {} });
  }
  async getSession(sessionId: string): Promise<AirtopSession> { return this.client.request<AirtopSession>(`/sessions/${sessionId}`); }
  async listSessions(): Promise<AirtopSessionList> { return this.client.request<AirtopSessionList>('/sessions'); }
  async terminateSession(sessionId: string): Promise<void> { await this.client.request(`/sessions/${sessionId}`, { method: 'DELETE' }); }

  async createWindow(sessionId: string, url: string): Promise<AirtopWindow> {
    return this.client.request<AirtopWindow>(`/sessions/${sessionId}/windows`, { method: 'POST', body: { url } });
  }
  async getWindow(sessionId: string, windowId: string): Promise<AirtopWindow> {
    return this.client.request<AirtopWindow>(`/sessions/${sessionId}/windows/${windowId}`);
  }
  async closeWindow(sessionId: string, windowId: string): Promise<void> {
    await this.client.request(`/sessions/${sessionId}/windows/${windowId}`, { method: 'DELETE' });
  }

  async scrape(sessionId: string, windowId: string): Promise<AirtopScrapeResult> {
    return this.client.request<AirtopScrapeResult>(`/sessions/${sessionId}/windows/${windowId}/scrape`, { method: 'POST' });
  }

  async prompt(sessionId: string, windowId: string, prompt: string): Promise<AirtopPromptResult> {
    return this.client.request<AirtopPromptResult>(`/sessions/${sessionId}/windows/${windowId}/prompt`, { method: 'POST', body: { prompt } });
  }

  async screenshot(sessionId: string, windowId: string): Promise<AirtopScreenshot> {
    return this.client.request<AirtopScreenshot>(`/sessions/${sessionId}/windows/${windowId}/screenshot`);
  }

  getClient(): AirtopClient { return this.client; }
}

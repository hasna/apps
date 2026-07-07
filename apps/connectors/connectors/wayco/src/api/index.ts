import type { WaycoConfig, RawRequestOptions } from '../types';
import { WaycoClient, encodePathSegment } from './client';

/**
 * Wayco connector for med-legal case management, lead intake,
 * medical record summaries, provider matching, and voice calls.
 */
export class Wayco {
  private readonly client: WaycoClient;

  constructor(config: WaycoConfig) {
    this.client = new WaycoClient(config);
  }

  static fromEnv(): Wayco {
    const apiKey = process.env.WAYCO_API_KEY;
    const baseUrl = process.env.WAYCO_BASE_URL;

    if (!apiKey) {
      throw new Error('WAYCO_API_KEY environment variable is required');
    }

    return new Wayco({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): WaycoClient {
    return this.client;
  }

  async listCases(query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.get('/cases', query);
  }

  async getCase(caseId: string): Promise<unknown> {
    return this.client.get(`/cases/${encodePathSegment(caseId)}`);
  }

  async createLead(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/leads', body);
  }

  async qualifyLead(leadId: string, body: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.post(`/leads/${encodePathSegment(leadId)}/qualify`, body);
  }

  async summarizeMedicalRecords(caseId: string, body: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.post(`/cases/${encodePathSegment(caseId)}/medical-records/summary`, body);
  }

  async matchProviders(caseId: string, body: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.post(`/cases/${encodePathSegment(caseId)}/provider-matches`, body);
  }

  async getVoiceCall(callId: string): Promise<unknown> {
    return this.client.get(`/voice-calls/${encodePathSegment(callId)}`);
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { path, method = 'GET', query, body, headers } = options;
    return this.client.request(path.startsWith('/') ? path : `/${path}`, {
      method,
      params: query,
      body,
      headers,
    });
  }
}

export { WaycoClient, encodePathSegment, DEFAULT_BASE_URL } from './client';

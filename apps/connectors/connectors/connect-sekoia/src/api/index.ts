// Sekoia Connector — Cyber threat intelligence and security operations
import { SekoiaClient } from './client';
import type { SekoiaConfig, SKAlert, SKAlertList, SKIndicator, SKRule, SKAsset, SKEvent } from '../types';
export { SekoiaClient } from './client';

export class Sekoia {
  private readonly client: SekoiaClient;
  constructor(config: SekoiaConfig) { this.client = new SekoiaClient(config); }
  static fromEnv(): Sekoia {
    const apiKey = process.env.SEKOIA_API_KEY;
    if (!apiKey) throw new Error('SEKOIA_API_KEY is required');
    return new Sekoia({ apiKey });
  }

  async listAlerts(options?: { limit?: number; offset?: number; status?: string; severity?: number }): Promise<SKAlertList> {
    return this.client.request<SKAlertList>('/sic/alerts', { params: { limit: options?.limit, offset: options?.offset, status: options?.status, severity: options?.severity } });
  }
  async getAlert(alertUuid: string): Promise<SKAlert> { return this.client.request<SKAlert>(`/sic/alerts/${alertUuid}`); }
  async updateAlertStatus(alertUuid: string, status: string, comment?: string): Promise<SKAlert> {
    return this.client.request<SKAlert>(`/sic/alerts/${alertUuid}/status`, { method: 'PATCH', body: { status, comment } });
  }

  async searchIndicators(query: string, options?: { limit?: number; type?: string }): Promise<{ items: SKIndicator[] }> {
    return this.client.request('/inthreat/indicators', { params: { value: query, limit: options?.limit, type: options?.type } });
  }
  async getIndicator(indicatorId: string): Promise<SKIndicator> { return this.client.request<SKIndicator>(`/inthreat/indicators/${indicatorId}`); }

  async listRules(options?: { limit?: number; enabled?: boolean }): Promise<{ items: SKRule[] }> {
    return this.client.request('/sic/rules', { params: { limit: options?.limit, enabled: options?.enabled === true ? 'true' : options?.enabled === false ? 'false' : undefined } });
  }

  async listAssets(options?: { limit?: number; type?: string }): Promise<{ items: SKAsset[] }> {
    return this.client.request('/assets', { params: { limit: options?.limit, type: options?.type } });
  }

  async listEvents(options?: { limit?: number; from?: string; to?: string }): Promise<{ items: SKEvent[] }> {
    return this.client.request('/sic/events', { params: { limit: options?.limit, date_from: options?.from, date_to: options?.to } });
  }

  getClient(): SekoiaClient { return this.client; }
}

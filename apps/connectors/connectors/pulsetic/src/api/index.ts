// Pulsetic Connector — Website uptime monitoring and status pages
import { PulseticClient } from './client';
import type { PulseticConfig, PLMonitor, PLMonitorList, PLIncident, PLStatusPage, PLHeartbeat } from '../types';
export { PulseticClient } from './client';

export class Pulsetic {
  private readonly client: PulseticClient;
  constructor(config: PulseticConfig) { this.client = new PulseticClient(config); }
  static fromEnv(): Pulsetic {
    const apiKey = process.env.PULSETIC_API_KEY;
    if (!apiKey) throw new Error('PULSETIC_API_KEY is required');
    return new Pulsetic({ apiKey });
  }

  async listMonitors(): Promise<PLMonitorList> { return this.client.request<PLMonitorList>('/monitors'); }
  async getMonitor(monitorId: number): Promise<PLMonitor> { return this.client.request<PLMonitor>(`/monitors/${monitorId}`); }
  async createMonitor(data: { name: string; url: string; type?: string; interval?: number }): Promise<PLMonitor> {
    return this.client.request<PLMonitor>('/monitors', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteMonitor(monitorId: number): Promise<void> { await this.client.request(`/monitors/${monitorId}`, { method: 'DELETE' }); }
  async pauseMonitor(monitorId: number): Promise<void> { await this.client.request(`/monitors/${monitorId}/pause`, { method: 'POST' }); }
  async resumeMonitor(monitorId: number): Promise<void> { await this.client.request(`/monitors/${monitorId}/resume`, { method: 'POST' }); }

  async listIncidents(monitorId: number): Promise<{ data: PLIncident[] }> { return this.client.request(`/monitors/${monitorId}/incidents`); }

  async getHeartbeats(monitorId: number, options?: { from?: string; to?: string }): Promise<{ data: PLHeartbeat[] }> {
    return this.client.request(`/monitors/${monitorId}/heartbeats`, { params: { from: options?.from, to: options?.to } });
  }

  async listStatusPages(): Promise<{ data: PLStatusPage[] }> { return this.client.request('/status-pages'); }

  getClient(): PulseticClient { return this.client; }
}

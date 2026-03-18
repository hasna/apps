// Alerty Connector — Website monitoring and alerting
import { AlertyClient } from './client';
import type { AlertyConfig, AlertyMonitor, AlertyMonitorList, AlertyIncident, AlertyIncidentList, AlertyStatusPage, AlertyAlert } from '../types';
export { AlertyClient } from './client';

export class Alerty {
  private readonly client: AlertyClient;
  constructor(config: AlertyConfig) { this.client = new AlertyClient(config); }
  static fromEnv(): Alerty {
    const apiKey = process.env.ALERTY_API_KEY;
    if (!apiKey) throw new Error('ALERTY_API_KEY is required');
    return new Alerty({ apiKey });
  }

  async listMonitors(): Promise<AlertyMonitorList> { return this.client.request<AlertyMonitorList>('/monitors'); }
  async getMonitor(monitorId: string): Promise<AlertyMonitor> { return this.client.request<AlertyMonitor>(`/monitors/${monitorId}`); }
  async createMonitor(data: { name: string; url: string; type?: string; interval?: number; regions?: string[] }): Promise<AlertyMonitor> {
    return this.client.request<AlertyMonitor>('/monitors', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateMonitor(monitorId: string, data: { name?: string; url?: string; interval?: number; regions?: string[] }): Promise<AlertyMonitor> {
    return this.client.request<AlertyMonitor>(`/monitors/${monitorId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteMonitor(monitorId: string): Promise<void> { await this.client.request(`/monitors/${monitorId}`, { method: 'DELETE' }); }
  async pauseMonitor(monitorId: string): Promise<void> { await this.client.request(`/monitors/${monitorId}/pause`, { method: 'POST' }); }
  async resumeMonitor(monitorId: string): Promise<void> { await this.client.request(`/monitors/${monitorId}/resume`, { method: 'POST' }); }

  async listIncidents(monitorId?: string): Promise<AlertyIncidentList> {
    return this.client.request<AlertyIncidentList>(monitorId ? `/monitors/${monitorId}/incidents` : '/incidents');
  }
  async getIncident(incidentId: string): Promise<AlertyIncident> { return this.client.request<AlertyIncident>(`/incidents/${incidentId}`); }

  async listStatusPages(): Promise<AlertyStatusPage[]> { return this.client.request<AlertyStatusPage[]>('/status-pages'); }
  async listAlerts(): Promise<AlertyAlert[]> { return this.client.request<AlertyAlert[]>('/alerts'); }

  getClient(): AlertyClient { return this.client; }
}

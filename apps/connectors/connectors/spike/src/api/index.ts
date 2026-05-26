// Spike Connector — Incident management and on-call alerting
import { SpikeClient } from './client';
import type { SpikeConfig, SPIncident, SPIncidentList, SPService, SPEscalationPolicy, SPOnCallSchedule } from '../types';
export { SpikeClient } from './client';

export class Spike {
  private readonly client: SpikeClient;
  constructor(config: SpikeConfig) { this.client = new SpikeClient(config); }
  static fromEnv(): Spike {
    const apiKey = process.env.SPIKE_API_KEY;
    if (!apiKey) throw new Error('SPIKE_API_KEY is required');
    return new Spike({ apiKey });
  }

  async listIncidents(options?: { page?: number; per_page?: number; status?: string; severity?: string }): Promise<SPIncidentList> {
    return this.client.request<SPIncidentList>('/incidents', { params: { page: options?.page, per_page: options?.per_page, status: options?.status, severity: options?.severity } });
  }
  async getIncident(incidentId: string): Promise<SPIncident> { return this.client.request<SPIncident>(`/incidents/${incidentId}`); }
  async createIncident(data: { title: string; description?: string; severity: string; service_id: string }): Promise<SPIncident> {
    return this.client.request<SPIncident>('/incidents', { method: 'POST', body: data as Record<string, unknown> });
  }
  async acknowledgeIncident(incidentId: string): Promise<SPIncident> {
    return this.client.request<SPIncident>(`/incidents/${incidentId}/acknowledge`, { method: 'POST' });
  }
  async resolveIncident(incidentId: string): Promise<SPIncident> {
    return this.client.request<SPIncident>(`/incidents/${incidentId}/resolve`, { method: 'POST' });
  }

  async listServices(): Promise<SPService[]> { return this.client.request<SPService[]>('/services'); }
  async listEscalationPolicies(): Promise<SPEscalationPolicy[]> { return this.client.request<SPEscalationPolicy[]>('/escalation-policies'); }
  async listOnCallSchedules(): Promise<SPOnCallSchedule[]> { return this.client.request<SPOnCallSchedule[]>('/on-call-schedules'); }

  getClient(): SpikeClient { return this.client; }
}

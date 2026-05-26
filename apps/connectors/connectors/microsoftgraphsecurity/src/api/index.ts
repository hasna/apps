// Microsoft Graph Security Connector — Unified security alerts, threats, and incidents
import { MSGraphSecurityClient } from './client';
import type { MSGraphSecurityConfig, MSAlert, MSAlertList, MSIncident, MSIncidentList, MSSecureScore } from '../types';
export { MSGraphSecurityClient } from './client';

export class MSGraphSecurity {
  private readonly client: MSGraphSecurityClient;
  constructor(config: MSGraphSecurityConfig) { this.client = new MSGraphSecurityClient(config); }
  static fromEnv(): MSGraphSecurity {
    const token = process.env.MSGRAPH_SECURITY_TOKEN;
    if (!token) throw new Error('MSGRAPH_SECURITY_TOKEN is required');
    return new MSGraphSecurity({ token });
  }

  async listAlerts(options?: { $top?: number; $filter?: string; $orderby?: string }): Promise<MSAlertList> {
    return this.client.request<MSAlertList>('/alerts_v2', { params: { $top: options?.$top, $filter: options?.$filter, $orderby: options?.$orderby } });
  }
  async getAlert(alertId: string): Promise<MSAlert> { return this.client.request<MSAlert>(`/alerts_v2/${alertId}`); }
  async updateAlert(alertId: string, data: { status?: string; assignedTo?: string; classification?: string; determination?: string }): Promise<MSAlert> {
    return this.client.request<MSAlert>(`/alerts_v2/${alertId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }

  async listIncidents(options?: { $top?: number; $filter?: string }): Promise<MSIncidentList> {
    return this.client.request<MSIncidentList>('/incidents', { params: { $top: options?.$top, $filter: options?.$filter } });
  }
  async getIncident(incidentId: string): Promise<MSIncident> { return this.client.request<MSIncident>(`/incidents/${incidentId}`); }
  async updateIncident(incidentId: string, data: { status?: string; assignedTo?: string; classification?: string }): Promise<MSIncident> {
    return this.client.request<MSIncident>(`/incidents/${incidentId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }

  async listSecureScores(options?: { $top?: number }): Promise<{ value: MSSecureScore[] }> {
    return this.client.request('/secureScores', { params: { $top: options?.$top } });
  }

  getClient(): MSGraphSecurityClient { return this.client; }
}

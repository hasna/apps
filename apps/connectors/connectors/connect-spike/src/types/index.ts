export interface SpikeConfig { apiKey: string; }

export interface SPIncident { id: string; title: string; description: string; severity: 'critical' | 'high' | 'medium' | 'low'; status: 'triggered' | 'acknowledged' | 'resolved'; service: { id: string; name: string }; assigned_to: { id: string; name: string } | null; created_at: string; resolved_at: string | null; }
export interface SPIncidentList { incidents: SPIncident[]; total: number; page: number; per_page: number; }
export interface SPService { id: string; name: string; description: string; status: string; escalation_policy_id: string; }
export interface SPEscalationPolicy { id: string; name: string; rules: { delay_minutes: number; targets: { type: string; id: string }[] }[]; }
export interface SPOnCallSchedule { id: string; name: string; timezone: string; current_on_call: { id: string; name: string; email: string } | null; }

export class SpikeApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SpikeApiError'; this.statusCode = statusCode; }
}

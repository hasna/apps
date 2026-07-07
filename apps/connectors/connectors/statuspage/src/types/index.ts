export type OutputFormat = 'json' | 'table' | 'pretty';

export interface StatuspageConfig {
  apiKey: string;
  pageId?: string;
}

export type ComponentStatus =
  | 'operational'
  | 'degraded_performance'
  | 'partial_outage'
  | 'major_outage'
  | 'under_maintenance';

export type IncidentStatus =
  | 'investigating'
  | 'identified'
  | 'monitoring'
  | 'resolved'
  | 'scheduled'
  | 'in_progress'
  | 'verifying'
  | 'completed';

export type IncidentImpact = 'none' | 'minor' | 'major' | 'critical';

export interface StatuspagePage {
  id: string;
  name: string;
  subdomain?: string;
  domain?: string;
  url?: string;
  page_description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface StatuspageComponent {
  id: string;
  page_id: string;
  group_id?: string | null;
  name: string;
  description?: string;
  status: ComponentStatus;
  position?: number;
  group?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface StatuspageIncidentUpdate {
  id: string;
  incident_id: string;
  status: IncidentStatus;
  body: string;
  created_at?: string;
  updated_at?: string;
  display_at?: string;
}

export interface StatuspageIncident {
  id: string;
  page_id: string;
  name: string;
  status: IncidentStatus;
  impact?: IncidentImpact;
  impact_override?: IncidentImpact | 'none';
  body?: string;
  shortlink?: string;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string | null;
  components?: StatuspageComponent[];
  incident_updates?: StatuspageIncidentUpdate[];
}

export interface CreateIncidentInput {
  name: string;
  status?: IncidentStatus;
  impact_override?: IncidentImpact | 'none';
  body?: string;
  component_ids?: string[];
  components?: Record<string, ComponentStatus>;
  deliver_notifications?: boolean;
}

export interface UpdateIncidentInput {
  name?: string;
  status?: IncidentStatus;
  impact_override?: IncidentImpact | 'none';
  body?: string;
  component_ids?: string[];
  components?: Record<string, ComponentStatus>;
  deliver_notifications?: boolean;
}

export class StatuspageApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'StatuspageApiError';
    this.statusCode = statusCode;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }
}

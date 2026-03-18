export interface KibanaConfig {
  baseUrl: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

export interface KibanaStatus {
  name: string;
  uuid: string;
  version: { number: string; build_hash: string };
  status: { overall: { level: string; summary: string } };
}

export interface SavedObject {
  id: string;
  type: string;
  version?: string;
  attributes: Record<string, unknown>;
  references: Array<{ id: string; name: string; type: string }>;
  namespaces?: string[];
  updated_at?: string;
  created_at?: string;
}

export interface DataView {
  id: string;
  name: string;
  title: string;
  timeFieldName?: string;
  fields?: Record<string, unknown>;
}

export interface AlertingRule {
  id: string;
  name: string;
  rule_type_id: string;
  enabled: boolean;
  schedule: { interval: string };
  consumer: string;
  actions: Array<{ id: string; group: string; params: Record<string, unknown> }>;
  last_execution_date?: string;
  last_run?: { outcome: string; warning?: string };
}

export interface Space {
  id: string;
  name: string;
  description?: string;
  color?: string;
  initials?: string;
  disabledFeatures: string[];
}

export class KibanaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'KibanaApiError';
    this.statusCode = statusCode;
  }
}

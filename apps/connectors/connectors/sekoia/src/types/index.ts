export interface SekoiaConfig { apiKey: string; }

export interface SKAlert { uuid: string; title: string; description: string; severity: number; status: { name: string }; rule: { uuid: string; name: string }; created_at: string; updated_at: string; entity: { uuid: string; name: string }; }
export interface SKAlertList { items: SKAlert[]; total: number; }
export interface SKIndicator { id: string; type: string; value: string; description: string; valid_from: string; valid_until: string; kill_chain_phases: string[]; source: string; }
export interface SKRule { uuid: string; name: string; description: string; severity: number; type: string; enabled: boolean; created_at: string; }
export interface SKAsset { uuid: string; name: string; type: string; description: string; criticality: number; created_at: string; }
export interface SKEvent { uuid: string; event_type: string; timestamp: string; source: string; details: Record<string, unknown>; }

export class SekoiaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SekoiaApiError'; this.statusCode = statusCode; }
}

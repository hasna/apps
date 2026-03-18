export interface SpecterConfig { apiKey: string; projectId: string; }

export interface SPApp { id: string; name: string; platform: string; status: string; created_at: string; }
export interface SPEvent { id: string; name: string; description: string; parameters: Record<string, unknown>; created_at: string; }
export interface SPEventData { event_name: string; count: number; users: number; date: string; }
export interface SPUser { id: string; username: string; email: string; first_seen: string; last_seen: string; sessions: number; country: string; platform: string; custom_data: Record<string, unknown>; }
export interface SPUserList { users: SPUser[]; total: number; page: number; per_page: number; }
export interface SPSegment { id: string; name: string; description: string; user_count: number; filters: Record<string, unknown>[]; }
export interface SPEconomy { item_id: string; name: string; type: string; price: number; currency: string; purchases: number; revenue: number; }

export class SpecterApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SpecterApiError'; this.statusCode = statusCode; }
}

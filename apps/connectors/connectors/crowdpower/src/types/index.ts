export interface CrowdPowerConfig { apiKey: string; }

export interface CPUser { id: string; email: string; name: string; created_at: string; last_seen_at: string; custom_attributes: Record<string, unknown>; tags: string[]; segments: string[]; }
export interface CPUserList { users: CPUser[]; total: number; page: number; per_page: number; }
export interface CPSegment { id: string; name: string; description: string; user_count: number; created_at: string; }
export interface CPCampaign { id: string; name: string; status: string; type: string; sent_count: number; open_count: number; click_count: number; created_at: string; }
export interface CPEvent { id: string; user_id: string; name: string; properties: Record<string, unknown>; created_at: string; }
export interface CPTag { id: string; name: string; user_count: number; }

export class CrowdPowerApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CrowdPowerApiError'; this.statusCode = statusCode; }
}

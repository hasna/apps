export interface OrttoConfig { apiKey: string; region?: string; }

export interface OTPerson { person_id: string; fields: Record<string, unknown>; tags: string[]; }
export interface OTPersonList { contacts: OTPerson[]; has_more: boolean; next_cursor: string | null; }
export interface OTActivity { activity_id: string; person_id: string; name: string; attributes: Record<string, unknown>; timestamp: string; }
export interface OTJourney { id: string; name: string; status: string; entry_count: number; active_count: number; }
export interface OTAudience { id: string; name: string; count: number; }
export interface OTTag { tag: string; count: number; }

export class OrttoApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'OrttoApiError'; this.statusCode = statusCode; }
}

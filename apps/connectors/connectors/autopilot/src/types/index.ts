export interface AutopilotConfig { apiKey: string; }

export interface APContact { contact_id: string; Email: string; FirstName: string; LastName: string; Company: string; Phone: string; custom: Record<string, unknown>; lists: string[]; }
export interface APContactList { contacts: APContact[]; total_contacts: number; }
export interface APList { list_id: string; title: string; }
export interface APJourney { journey_id: string; title: string; status: string; }
export interface APSmartSegment { segment_id: string; title: string; contact_count: number; }

export class AutopilotApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AutopilotApiError'; this.statusCode = statusCode; }
}

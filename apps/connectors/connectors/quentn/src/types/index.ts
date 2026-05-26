export interface QuentnConfig { apiKey: string; baseUrl?: string; }

export interface QNContact { id: number; mail: string; first_name: string; last_name: string; company: string; phone: string; date_added: string; date_modified: string; tags: number[]; custom_fields: Record<string, string>; }
export interface QNContactList { data: QNContact[]; total: number; offset: number; limit: number; }
export interface QNTag { id: number; name: string; description: string; }
export interface QNCampaign { id: number; name: string; status: string; type: string; created_at: string; }
export interface QNTerm { id: number; name: string; description: string; }
export interface QNCustomField { id: number; label: string; field_name: string; type: string; required: boolean; }

export class QuentnApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'QuentnApiError'; this.statusCode = statusCode; }
}

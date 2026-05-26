export interface CustomerIOConfig { siteId: string; apiKey: string; appApiKey?: string; }

export interface CIOCustomer { id: string; email: string; created_at: number; attributes: Record<string, unknown>; }
export interface CIOSegment { id: number; name: string; description: string; }
export interface CIOCampaign { id: number; name: string; type: string; active: boolean; created: number; updated: number; }
export interface CIOMessage { id: string; recipient: string; subject: string; type: string; created_at: number; }
export interface CIOMessageList { messages: CIOMessage[]; next: string | null; }
export interface CIOEvent { name: string; data: Record<string, unknown>; timestamp?: number; }

export class CustomerIOApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CustomerIOApiError'; this.statusCode = statusCode; }
}

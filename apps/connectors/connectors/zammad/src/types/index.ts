export interface ZammadConfig { url: string; token: string; }

export interface ZDTicket { id: number; number: string; title: string; group_id: number; state_id: number; priority_id: number; customer_id: number; owner_id: number; note?: string; created_at: string; updated_at: string; }
export interface ZDUser { id: number; login: string; firstname: string; lastname: string; email: string; active: boolean; role_ids: number[]; created_at: string; }
export interface ZDGroup { id: number; name: string; active: boolean; note?: string; }
export interface ZDArticle { id: number; ticket_id: number; from: string; to?: string; subject: string; body: string; content_type: string; internal: boolean; created_at: string; }
export interface ZDOrganization { id: number; name: string; active: boolean; domain?: string; note?: string; }

export class ZammadApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ZammadApiError'; this.statusCode = statusCode; }
}

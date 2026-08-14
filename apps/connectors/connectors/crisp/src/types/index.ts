export interface CrispConfig { websiteId: string; tokenId: string; tokenKey: string; }

export interface CRConversation { session_id: string; website_id: string; state: string; status: number; is_verified: boolean; is_blocked: boolean; availability: string; created_at: number; updated_at: number; meta: { nickname: string; email: string; avatar: string }; }
export interface CRMessage { session_id: string; website_id: string; type: string; from: string; origin: string; content: string; timestamp: number; fingerprint: number; user: { nickname: string; user_id: string }; }
export interface CRPeople { people_id: string; email: string; person: { nickname: string; avatar: string }; data: Record<string, unknown>; }
export interface CRWebsite { website_id: string; name: string; domain: string; }

export class CrispApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CrispApiError'; this.statusCode = statusCode; }
}

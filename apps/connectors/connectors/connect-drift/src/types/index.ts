export interface DriftConfig { accessToken: string; baseUrl?: string; }

export interface DriftContact { id: number; attributes: Record<string, unknown>; createdAt: number; }
export interface DriftConversation { id: number; status: 'open' | 'closed' | 'pending'; contactId: number; createdAt: number; updatedAt: number; }
export interface DriftMessage { id: string; body: string; type: 'chat' | 'private_note'; author: { id: number; type: 'contact' | 'user' }; createdAt: number; conversationId: number; }
export interface DriftUser { id: number; name: string; email: string; role: string; avatarUrl: string | null; }

export class DriftApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'DriftApiError'; this.statusCode = statusCode; }
}

export interface EarthoConfig { clientId: string; clientSecret: string; }

export interface EOUser { uid: string; email: string; displayName: string; photoURL: string | null; providerId: string; createdAt: string; lastLoginAt: string; }
export interface EOAccess { access_id: string; name: string; description: string; type: string; price: number | null; currency: string | null; }
export interface EOConnection { id: string; name: string; provider: string; enabled: boolean; }

export class EarthoApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'EarthoApiError'; this.statusCode = statusCode; }
}

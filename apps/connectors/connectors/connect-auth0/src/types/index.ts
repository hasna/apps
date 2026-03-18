// Auth0 uses domain-specific URLs, not a fixed base URL
export interface Auth0Config { domain: string; managementToken: string; clientId?: string; clientSecret?: string; }

export interface Auth0User { user_id: string; email: string; email_verified: boolean; name: string; nickname: string; picture: string; created_at: string; updated_at: string; last_login?: string; logins_count?: number; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown>; blocked?: boolean; }
export interface Auth0Role { id: string; name: string; description: string; }
export interface Auth0Connection { id: string; name: string; strategy: string; enabled_clients: string[]; }
export interface Auth0Log { _id: string; date: string; type: string; description: string; client_id?: string; user_id?: string; ip?: string; }
export interface Auth0Organization { id: string; name: string; display_name: string; }

export class Auth0ApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'Auth0ApiError'; this.statusCode = statusCode; }
}

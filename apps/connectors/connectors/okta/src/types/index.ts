export interface OktaConfig { domain: string; token: string; }

export interface OktaUser { id: string; status: string; created: string; activated: string | null; lastLogin: string | null; lastUpdated: string; profile: { firstName: string; lastName: string; email: string; login: string; mobilePhone: string | null }; }
export interface OktaGroup { id: string; created: string; lastUpdated: string; lastMembershipUpdated: string; type: string; profile: { name: string; description: string }; }
export interface OktaApp { id: string; name: string; label: string; status: string; created: string; lastUpdated: string; signOnMode: string; }
export interface OktaAuthServer { id: string; name: string; description: string; audiences: string[]; issuer: string; status: string; created: string; }
export interface OktaPolicy { id: string; status: string; name: string; description: string; type: string; created: string; lastUpdated: string; }
export interface OktaLog { actor: { id: string; type: string; displayName: string }; client: { ipAddress: string }; eventType: string; displayMessage: string; outcome: { result: string }; published: string; }

export class OktaApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: string;
  constructor(message: string, statusCode: number, errorCode?: string) { super(message); this.name = 'OktaApiError'; this.statusCode = statusCode; this.errorCode = errorCode; }
}

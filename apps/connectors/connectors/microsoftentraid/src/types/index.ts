export interface MSEntraIDConfig { token: string; }

export interface MEUser { id: string; displayName: string; userPrincipalName: string; mail: string | null; givenName: string; surname: string; jobTitle: string | null; accountEnabled: boolean; }
export interface MEUserList { value: MEUser[]; '@odata.nextLink'?: string; }
export interface MEGroup { id: string; displayName: string; description: string | null; mailEnabled: boolean; securityEnabled: boolean; }
export interface MEGroupList { value: MEGroup[]; '@odata.nextLink'?: string; }
export interface MEApp { id: string; appId: string; displayName: string; signInAudience: string; }

export class MSEntraIDApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'MSEntraIDApiError'; this.statusCode = statusCode; }
}

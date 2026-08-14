export interface EntraIDConfig { token: string; }

export interface ADUser { id: string; displayName: string; userPrincipalName: string; mail: string | null; givenName: string; surname: string; jobTitle: string | null; department: string | null; accountEnabled: boolean; createdDateTime: string; }
export interface ADUserList { value: ADUser[]; '@odata.nextLink'?: string; }
export interface ADGroup { id: string; displayName: string; description: string | null; mailEnabled: boolean; securityEnabled: boolean; groupTypes: string[]; membershipRule: string | null; createdDateTime: string; }
export interface ADGroupList { value: ADGroup[]; '@odata.nextLink'?: string; }
export interface ADApplication { id: string; appId: string; displayName: string; signInAudience: string; createdDateTime: string; }
export interface ADServicePrincipal { id: string; appId: string; displayName: string; servicePrincipalType: string; }
export interface ADDomain { id: string; authenticationType: string; isDefault: boolean; isVerified: boolean; }

export class EntraIDApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'EntraIDApiError'; this.statusCode = statusCode; }
}

export interface LoginRadiusConfig { apiKey: string; apiSecret: string; appName: string; }

export interface LRProfile { Uid: string; ID: string; Email: { Type: string; Value: string }[]; FirstName: string; LastName: string; FullName: string; ProfileUrl: string; ImageUrl: string; Provider: string; CreatedDate: string; ModifiedDate: string; }
export interface LRProfileList { data: LRProfile[]; totalcount: number; }
export interface LRRole { Name: string; Permissions: Record<string, boolean>; }
export interface LRCustomObject { Id: string; CustomObject: Record<string, unknown>; DateCreated: string; DateModified: string; IsActive: boolean; }
export interface LRIdentity { Provider: string; ID: string; Email: string; }

export class LoginRadiusApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: number;
  constructor(message: string, statusCode: number, errorCode?: number) { super(message); this.name = 'LoginRadiusApiError'; this.statusCode = statusCode; this.errorCode = errorCode; }
}

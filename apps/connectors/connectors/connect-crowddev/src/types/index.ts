export interface CrowdDevConfig { apiKey: string; tenantId: string; }

export interface CDMember { id: string; displayName: string; emails: string[]; organizations: { id: string; name: string }[]; joinedAt: string; reach: number; score: number; tags: string[]; platform: string; }
export interface CDMemberList { rows: CDMember[]; count: number; limit: number; offset: number; }
export interface CDActivity { id: string; type: string; platform: string; timestamp: string; member: { id: string; displayName: string }; channel: string; body: string; url: string; sentiment: { positive: number; negative: number; neutral: number }; }
export interface CDActivityList { rows: CDActivity[]; count: number; limit: number; offset: number; }
export interface CDOrganization { id: string; name: string; url: string; memberCount: number; activityCount: number; }

export class CrowdDevApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CrowdDevApiError'; this.statusCode = statusCode; }
}

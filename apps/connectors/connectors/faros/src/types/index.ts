export interface FarosConfig { apiKey: string; baseUrl?: string; }

export interface FarosDeployment { uid: string; application: string; environment: string; status: string; startedAt: string; endedAt: string | null; source: string; }
export interface FarosBuild { uid: string; pipeline: string; number: number; status: string; startedAt: string; endedAt: string | null; source: string; }
export interface FarosIncident { uid: string; title: string; severity: string; status: string; createdAt: string; resolvedAt: string | null; source: string; }
export interface FarosMetric { name: string; value: number; timestamp: string; tags: Record<string, string>; }
export interface FarosTeam { uid: string; name: string; description: string; members: { uid: string; name: string; email: string }[]; }
export interface FarosQueryResult { data: Record<string, unknown>[]; metadata: { totalCount: number }; }

export class FarosApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'FarosApiError'; this.statusCode = statusCode; }
}

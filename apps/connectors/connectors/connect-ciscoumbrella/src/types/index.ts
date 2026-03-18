export interface CiscoUmbrellaConfig { apiKey: string; apiSecret: string; orgId: string; }

export interface CUDestination { id: number; destination: string; type: string; comment: string; createdAt: string; }
export interface CUDestinationList { id: number; name: string; access: string; isGlobal: boolean; bundleTypeId: number; destinations: CUDestination[]; }
export interface CUReport { domain: string; totalRequests: number; blockedRequests: number; allowedRequests: number; }
export interface CUCategory { id: number; label: string; type: string; deprecated: boolean; }
export interface CUSecurityEvent { domain: string; datetime: string; categories: string[]; actionTaken: string; identities: { id: number; label: string }[]; }

export class CiscoUmbrellaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CiscoUmbrellaApiError'; this.statusCode = statusCode; }
}

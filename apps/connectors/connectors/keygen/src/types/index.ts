export interface KeygenConfig { accountId: string; token: string; }

export interface KGLicense { id: string; type: string; attributes: { key: string; name: string; status: string; expiry: string | null; maxMachines: number; maxUses: number | null; uses: number; created: string; updated: string }; relationships: { policy: { data: { id: string } }; user: { data: { id: string } | null } }; }
export interface KGPolicy { id: string; type: string; attributes: { name: string; duration: number | null; maxMachines: number; requireHeartbeat: boolean; strict: boolean; floating: boolean; scheme: string; created: string }; }
export interface KGMachine { id: string; type: string; attributes: { fingerprint: string; name: string; ip: string; hostname: string; platform: string; cores: number; created: string; lastHeartbeat: string | null }; }
export interface KGUser { id: string; type: string; attributes: { firstName: string; lastName: string; email: string; status: string; role: string; created: string }; }
export interface KGEntitlement { id: string; type: string; attributes: { name: string; code: string; created: string }; }

export class KeygenApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'KeygenApiError'; this.statusCode = statusCode; }
}

export interface EvervaultConfig { appId: string; apiKey: string; }

export interface EVEncryptResult { data: unknown; }
export interface EVDecryptResult { data: unknown; }
export interface EVFunction { name: string; status: string; created_at: string; updated_at: string; }
export interface EVFunctionRunResult { id: string; result: unknown; status: string; }
export interface EVCage { name: string; uuid: string; state: string; created_at: string; }
export interface EVApp { app_uuid: string; name: string; team_uuid: string; created_at: string; }

export class EvervaultApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'EvervaultApiError'; this.statusCode = statusCode; }
}

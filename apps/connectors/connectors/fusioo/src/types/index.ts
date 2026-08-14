export interface FusiooConfig { token: string; }

export interface FusiooApp { id: string; name: string; description: string; fields: FusiooField[]; created_at: string; }
export interface FusiooField { id: string; name: string; type: string; required: boolean; options?: string[]; }
export interface FusiooRecord { id: string; fields: Record<string, unknown>; created_at: string; updated_at: string; }
export interface FusiooRecordList { records: FusiooRecord[]; total: number; page: number; per_page: number; }
export interface FusiooWorkspace { id: string; name: string; apps: { id: string; name: string }[]; }

export class FusiooApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'FusiooApiError'; this.statusCode = statusCode; }
}

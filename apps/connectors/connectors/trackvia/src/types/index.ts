export interface TrackViaConfig { token: string; accountId: string; }

export interface TVApp { id: number; name: string; description: string; }
export interface TVTable { id: number; name: string; description: string; app_id: number; }
export interface TVRecord { id: number; data: Record<string, unknown>; created: string; updated: string; }
export interface TVRecordList { structure: { fields: { name: string; type: string; required: boolean }[] }; data: TVRecord[]; totalCount: number; }
export interface TVView { id: number; name: string; description: string; table_id: number; }
export interface TVUser { id: number; email: string; firstName: string; lastName: string; role: string; status: string; }

export class TrackViaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TrackViaApiError'; this.statusCode = statusCode; }
}

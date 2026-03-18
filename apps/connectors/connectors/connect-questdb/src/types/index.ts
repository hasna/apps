export interface QuestDBConfig { url: string; username?: string; password?: string; }

export interface QDBQueryResult { query: string; columns: { name: string; type: string }[]; dataset: unknown[][]; count: number; timings: { compiler: number; execute: number; count: number }; }
export interface QDBTable { name: string; partitionBy: string; designatedTimestamp: string | null; walEnabled: boolean; }
export interface QDBColumn { column: string; type: string; indexed: boolean; indexBlockCapacity: number; symbolCached: boolean; symbolCapacity: number; designated: boolean; }
export interface QDBImportResult { status: string; location: string; rowsRejected: number; rowsImported: number; header: boolean; columns: { name: string; type: string; size: number; errors: number }[]; }

export class QuestDBApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'QuestDBApiError'; this.statusCode = statusCode; }
}

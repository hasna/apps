export interface CloudBoostConfig { appId: string; masterKey: string; }

export interface CBTable { name: string; columns: CBColumn[]; }
export interface CBColumn { name: string; dataType: string; required: boolean; unique: boolean; relatedTo: string | null; }
export interface CBDocument { _id: string; _tableName: string; createdAt: string; updatedAt: string; ACL: Record<string, unknown>; [key: string]: unknown; }
export interface CBSearchResult { documents: CBDocument[]; totalCount: number; }
export interface CBUser { _id: string; username: string; email: string; createdAt: string; }
export interface CBFile { _id: string; name: string; url: string; size: number; contentType: string; }

export class CloudBoostApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CloudBoostApiError'; this.statusCode = statusCode; }
}

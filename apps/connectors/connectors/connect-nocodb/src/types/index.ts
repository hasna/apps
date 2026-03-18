export interface NocoDBConfig { token: string; baseUrl?: string; }

export interface NocTable { id: string; title: string; meta: Record<string, unknown>; columns: NocColumn[]; }
export interface NocColumn { id: string; title: string; uidt: string; dt: string; rqd: boolean; pk: boolean; ai: boolean; }
export interface NocRecord { Id: number; [key: string]: unknown; }
export interface NocRecordList { list: NocRecord[]; pageInfo: { totalRows: number; page: number; pageSize: number; isFirstPage: boolean; isLastPage: boolean }; }
export interface NocBase { id: string; title: string; description: string; status: string; created_at: string; }
export interface NocView { id: string; title: string; type: number; is_default: boolean; show_system_fields: boolean; }
export interface NocSharedView { id: string; url: string; password: string | null; }

export class NocoDBApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'NocoDBApiError'; this.statusCode = statusCode; }
}

export interface GristConfig { apiKey: string; serverUrl?: string; }

export interface GROrg { id: number; name: string; domain: string; }
export interface GRWorkspace { id: number; name: string; orgDomain: string; docs: { id: string; name: string }[]; }
export interface GRDocument { id: string; name: string; isPinned: boolean; urlId: string | null; workspace: { id: number; name: string }; }
export interface GRTable { id: string; fields: GRColumn[]; }
export interface GRColumn { id: string; label: string; type: string; widgetOptions?: Record<string, unknown>; }
export interface GRRecord { id: number; fields: Record<string, unknown>; }
export interface GRRecordList { records: GRRecord[]; }

export class GristApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'GristApiError'; this.statusCode = statusCode; }
}

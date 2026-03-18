export interface AITableConfig { token: string; baseUrl?: string; }

export interface AITSpace { id: string; name: string; }
export interface AITNode { id: string; name: string; type: string; icon: string; parentId: string; }
export interface AITField { id: string; name: string; type: string; property?: Record<string, unknown>; }
export interface AITRecord { recordId: string; fields: Record<string, unknown>; createdAt: number; updatedAt: number; }
export interface AITRecordList { total: number; pageNum: number; pageSize: number; records: AITRecord[]; }
export interface AITView { id: string; name: string; type: string; }

export class AITableApiError extends Error {
  public readonly statusCode: number;
  public readonly code: number;
  constructor(message: string, statusCode: number, code?: number) { super(message); this.name = 'AITableApiError'; this.statusCode = statusCode; this.code = code || statusCode; }
}

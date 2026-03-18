export interface ApptiveGridConfig { token: string; baseUrl?: string; }

export interface AGSpace { id: string; name: string; key: string; created_at: string; }
export interface AGGrid { id: string; name: string; key: string; space_id: string; fields: AGField[]; }
export interface AGField { id: string; name: string; type: string; key: string; }
export interface AGEntity { id: string; fields: Record<string, unknown>; created_at: string; updated_at: string; }
export interface AGEntityList { entities: AGEntity[]; total: number; page: number; page_size: number; }
export interface AGForm { id: string; name: string; grid_id: string; fields: AGField[]; }

export class ApptiveGridApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ApptiveGridApiError'; this.statusCode = statusCode; }
}

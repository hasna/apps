export interface QuintaDBConfig { apiKey: string; appId: string; baseUrl?: string; }

export interface QDBEntity { id: string; name: string; properties: Array<{ id: string; name: string; type: string }>; records_count: number; }
export interface QDBRecord { id: string; entity_id: string; values: Record<string, unknown>; created_at: string; updated_at: string; }
export interface QDBProperty { id: string; name: string; type: 'string' | 'integer' | 'float' | 'date' | 'boolean' | 'file' | 'reference'; required: boolean; }

export class QuintaDBApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'QuintaDBApiError'; this.statusCode = statusCode; }
}

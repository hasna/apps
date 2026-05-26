export interface AlphamoonConfig { token: string; }

export interface AMDocument { id: string; name: string; status: string; pages_count: number; created_at: string; updated_at: string; }
export interface AMDocumentList { documents: AMDocument[]; total: number; page: number; }
export interface AMExtractionResult { document_id: string; fields: AMField[]; tables: AMTable[]; }
export interface AMField { name: string; value: string; confidence: number; bounding_box?: { x: number; y: number; width: number; height: number; page: number }; }
export interface AMTable { name: string; rows: Record<string, string>[]; headers: string[]; }
export interface AMTemplate { id: string; name: string; fields: { name: string; type: string }[]; created_at: string; }
export interface AMProject { id: string; name: string; template_id: string; documents_count: number; created_at: string; }

export class AlphamoonApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AlphamoonApiError'; this.statusCode = statusCode; }
}

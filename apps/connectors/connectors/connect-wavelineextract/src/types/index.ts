export interface WavelineConfig { apiKey: string; }

export interface WLExtraction { id: string; status: 'pending' | 'processing' | 'completed' | 'failed'; document_url: string; fields: WLField[]; created_at: string; completed_at: string | null; }
export interface WLField { name: string; value: string; confidence: number; type: string; bounding_box?: { x: number; y: number; width: number; height: number; page: number }; }
export interface WLTemplate { id: string; name: string; fields: { name: string; type: string; required: boolean }[]; created_at: string; }

export class WavelineApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'WavelineApiError'; this.statusCode = statusCode; }
}

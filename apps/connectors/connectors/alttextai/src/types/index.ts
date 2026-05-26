export interface AltTextAiConfig { apiKey: string; }

export interface AltTextResult { alt_text: string; asset_id: string; url: string; created_at: string; }
export interface AltTextAccount { email: string; plan: string; credits_remaining: number; credits_used: number; }
export interface AltTextAsset { id: string; url: string; alt_text: string; status: string; created_at: string; updated_at: string; }
export interface AltTextAssetList { assets: AltTextAsset[]; page: number; per_page: number; total: number; }

export class AltTextAiApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AltTextAiApiError'; this.statusCode = statusCode; }
}

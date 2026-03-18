export interface AirtopConfig { apiKey: string; }

export interface AirtopSession { id: string; status: string; created_at: string; browser_url: string; live_view_url: string; }
export interface AirtopSessionList { sessions: AirtopSession[]; }
export interface AirtopWindow { id: string; session_id: string; url: string; title: string; status: string; }
export interface AirtopScrapeResult { content: string; url: string; title: string; }
export interface AirtopPromptResult { response: string; model_response: string; }
export interface AirtopScreenshot { image_url: string; }

export class AirtopApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'AirtopApiError'; this.statusCode = statusCode; }
}

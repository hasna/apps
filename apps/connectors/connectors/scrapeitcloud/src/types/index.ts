export interface ScrapeItCloudConfig { apiKey: string; }

export interface SICResult { url: string; status_code: number; content: string; headers: Record<string, string>; }
export interface SICScreenshot { url: string; screenshot_url: string; }
export interface SICExtractResult { url: string; data: Record<string, unknown>[]; }
export interface SICCredits { used: number; remaining: number; total: number; }

export class ScrapeItCloudApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ScrapeItCloudApiError'; this.statusCode = statusCode; }
}

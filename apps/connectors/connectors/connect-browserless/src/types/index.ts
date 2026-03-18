export interface BrowserlessConfig { apiKey: string; baseUrl?: string; }

export interface BLScreenshotOptions { url: string; options?: { fullPage?: boolean; type?: 'png' | 'jpeg' | 'webp'; quality?: number; clip?: { x: number; y: number; width: number; height: number } }; gotoOptions?: { waitUntil?: string; timeout?: number }; }
export interface BLPdfOptions { url: string; options?: { format?: string; landscape?: boolean; printBackground?: boolean; margin?: { top?: string; right?: string; bottom?: string; left?: string } }; gotoOptions?: { waitUntil?: string; timeout?: number }; }
export interface BLContentResult { data: string; type: string; }
export interface BLScrapeResult { data: { selector: string; results: { text?: string; html?: string; attributes?: Record<string, string> }[] }[]; }
export interface BLPerformanceResult { metrics: Record<string, number>; }

export class BrowserlessApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'BrowserlessApiError'; this.statusCode = statusCode; }
}

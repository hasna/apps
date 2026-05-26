export interface CloudLayerConfig { apiKey: string; }

export interface CLPdfResult { url: string; size: number; pages: number; }
export interface CLImageResult { url: string; size: number; width: number; height: number; }
export interface CLPdfOptions { html?: string; url?: string; filename?: string; format?: 'A4' | 'A3' | 'Letter' | 'Legal'; landscape?: boolean; margin?: { top?: string; right?: string; bottom?: string; left?: string }; header?: string; footer?: string; printBackground?: boolean; scale?: number; }
export interface CLImageOptions { html?: string; url?: string; filename?: string; format?: 'png' | 'jpeg' | 'webp'; width?: number; height?: number; fullPage?: boolean; quality?: number; deviceScaleFactor?: number; selector?: string; }
export interface CLUsage { credits_used: number; credits_remaining: number; plan: string; }

export class CloudLayerApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CloudLayerApiError'; this.statusCode = statusCode; }
}

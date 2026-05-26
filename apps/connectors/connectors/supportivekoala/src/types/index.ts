export interface SupportiveKoalaConfig { apiKey: string; }

export interface SKTemplate { id: string; name: string; width: number; height: number; layers: SKLayer[]; preview_url: string; created_at: string; }
export interface SKLayer { id: string; name: string; type: 'text' | 'image' | 'shape'; properties: Record<string, unknown>; }
export interface SKImage { id: string; template_id: string; url: string; width: number; height: number; format: string; created_at: string; }
export interface SKGenerateOptions { template_id: string; modifications: Record<string, string | number>; format?: 'png' | 'jpg' | 'webp'; width?: number; height?: number; }

export class SupportiveKoalaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SupportiveKoalaApiError'; this.statusCode = statusCode; }
}

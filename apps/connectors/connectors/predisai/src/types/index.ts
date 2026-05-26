export interface PredisAIConfig { apiKey: string; }

export interface PAPost { id: string; text: string; caption: string; hashtags: string[]; media_url: string; status: string; platform: string; scheduled_at: string | null; created_at: string; }
export interface PAPostList { posts: PAPost[]; total: number; page: number; }
export interface PAGeneration { id: string; text: string; image_url: string; video_url: string | null; hashtags: string[]; platform: string; }
export interface PABrand { id: string; name: string; description: string; colors: string[]; logo_url: string; }

export class PredisAIApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'PredisAIApiError'; this.statusCode = statusCode; }
}

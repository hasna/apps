export interface ProdiaConfig { apiKey: string; baseUrl?: string; }
export interface GenerateImageOptions {
  model?: string;
  prompt: string;
  negativePrompt?: string;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  width?: number;
  height?: number;
  sampler?: string;
  upscale?: boolean;
}
export interface ProdiaJob {
  job: string;
  status: 'queued' | 'generating' | 'succeeded' | 'failed';
  imageUrl?: string;
  params?: Record<string, unknown>;
}
export interface ProdiaModel { model: string; }
export class ProdiaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ProdiaApiError'; this.statusCode = statusCode; }
}

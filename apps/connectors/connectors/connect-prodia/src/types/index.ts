export interface ProdiaConfig { apiKey: string; }

export interface ProdiaJob { job: string; status: 'queued' | 'generating' | 'succeeded' | 'failed'; imageUrl?: string; params: Record<string, unknown>; }
export interface ProdiaModel { id: string; name: string; }
export interface ProdiaGenerateParams { model?: string; prompt: string; negative_prompt?: string; steps?: number; cfg_scale?: number; seed?: number; sampler?: string; width?: number; height?: number; }
export interface ProdiaTransformParams { model?: string; imageUrl: string; prompt: string; negative_prompt?: string; steps?: number; cfg_scale?: number; denoising_strength?: number; seed?: number; sampler?: string; }

export class ProdiaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ProdiaApiError'; this.statusCode = statusCode; }
}

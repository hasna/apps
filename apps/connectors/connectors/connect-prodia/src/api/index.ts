// Prodia Connector — Fast AI image generation (Stable Diffusion)
import { ProdiaClient } from './client';
import type { ProdiaConfig, GenerateImageOptions, ProdiaJob, ProdiaModel } from '../types';
export { ProdiaClient } from './client';
export class Prodia {
  private readonly client: ProdiaClient;
  constructor(config: ProdiaConfig) { this.client = new ProdiaClient(config); }
  static fromEnv(): Prodia {
    const apiKey = process.env.PRODIA_API_KEY;
    if (!apiKey) throw new Error('PRODIA_API_KEY environment variable is required');
    return new Prodia({ apiKey });
  }
  /** Generate an image (returns a job — poll with getJob until status="succeeded") */
  async generate(options: GenerateImageOptions): Promise<ProdiaJob> {
    return this.client.request<ProdiaJob>('/sd/generate', {
      method: 'POST',
      body: {
        model: options.model,
        prompt: options.prompt,
        negative_prompt: options.negativePrompt,
        steps: options.steps ?? 25,
        cfg_scale: options.cfgScale ?? 7,
        seed: options.seed ?? -1,
        width: options.width ?? 512,
        height: options.height ?? 512,
        sampler: options.sampler ?? 'DPM++ 2M Karras',
        upscale: options.upscale ?? false,
      },
    });
  }
  /** Generate image-to-image transformation */
  async transform(options: GenerateImageOptions & { imageUrl: string; denoiseStrength?: number }): Promise<ProdiaJob> {
    return this.client.request<ProdiaJob>('/sd/transform', {
      method: 'POST',
      body: {
        imageUrl: options.imageUrl,
        model: options.model,
        prompt: options.prompt,
        negative_prompt: options.negativePrompt,
        denoising_strength: options.denoiseStrength ?? 0.6,
        steps: options.steps ?? 25,
        cfg_scale: options.cfgScale ?? 7,
        seed: options.seed ?? -1,
        sampler: options.sampler ?? 'DPM++ 2M Karras',
      },
    });
  }
  /** Poll job status — call until status is "succeeded" or "failed" */
  async getJob(jobId: string): Promise<ProdiaJob> {
    return this.client.request<ProdiaJob>(`/job/${jobId}`);
  }
  /** Wait for job completion (polls every 2 seconds, max 60s) */
  async waitForJob(jobId: string, maxWaitMs = 60000): Promise<ProdiaJob> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const job = await this.getJob(jobId);
      if (job.status === 'succeeded' || job.status === 'failed') return job;
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error(`Job ${jobId} did not complete within ${maxWaitMs}ms`);
  }
  async listModels(): Promise<ProdiaModel[]> {
    const models = await this.client.request<string[]>('/sd/models');
    return models.map(model => ({ model }));
  }
  async listSamplers(): Promise<string[]> {
    return this.client.request<string[]>('/sd/samplers');
  }
  getClient(): ProdiaClient { return this.client; }
}

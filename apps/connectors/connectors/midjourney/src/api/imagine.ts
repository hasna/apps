import type { MidjourneyClient } from './client';
import type { ImagineJob, ImagineListResponse, ImagineParams, VariationParams, UpscaleParams } from '../types';

/**
 * Imagine API module - handles image generation
 */
export class ImagineApi {
  constructor(private readonly client: MidjourneyClient) {}

  /**
   * Create a new image generation job
   */
  async create(params: ImagineParams): Promise<ImagineJob> {
    return this.client.post<ImagineJob>('/imagine', params);
  }

  /**
   * Get the status of a generation job
   */
  async get(jobId: string): Promise<ImagineJob> {
    return this.client.get<ImagineJob>(`/jobs/${jobId}`);
  }

  /**
   * List recent generation jobs with optional pagination
   */
  async list(options?: { limit?: number; pageToken?: string }): Promise<ImagineListResponse> {
    return this.client.get<ImagineListResponse>('/jobs', {
      limit: options?.limit,
      page_token: options?.pageToken,
    });
  }

  /**
   * Create a variation of an existing image
   */
  async variation(params: VariationParams): Promise<ImagineJob> {
    return this.client.post<ImagineJob>(`/jobs/${params.jobId}/variation`, {
      index: params.index,
      type: params.type || 'subtle',
    });
  }

  /**
   * Upscale an existing image
   */
  async upscale(params: UpscaleParams): Promise<ImagineJob> {
    return this.client.post<ImagineJob>(`/jobs/${params.jobId}/upscale`, {
      index: params.index,
      type: params.type || 'subtle',
    });
  }

  /**
   * Cancel a pending job
   */
  async cancel(jobId: string): Promise<void> {
    await this.client.delete(`/jobs/${jobId}`);
  }

  /**
   * Wait for a job to complete (with polling)
   */
  async waitForCompletion(jobId: string, options?: {
    maxWaitMs?: number;
    pollIntervalMs?: number;
  }): Promise<ImagineJob> {
    const maxWait = options?.maxWaitMs || 300000; // 5 minutes default
    const pollInterval = options?.pollIntervalMs || 2000; // 2 seconds default
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const job = await this.get(jobId);

      if (job.status === 'completed' || job.status === 'failed') {
        return job;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Job ${jobId} did not complete within ${maxWait}ms`);
  }
}

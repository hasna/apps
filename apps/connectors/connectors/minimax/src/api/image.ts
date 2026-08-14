import type { MinimaxClient } from './client';
import type {
  ImageModel,
  ImageGenerateRequest,
  ImageGenerateResponse,
  ImageStatusResponse,
} from '../types';

export interface ImageOptions {
  model?: ImageModel;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  n?: number;
  promptOptimizer?: boolean;
}

export class ImageApi {
  constructor(private readonly client: MinimaxClient) {}

  async generate(prompt: string, options: ImageOptions = {}): Promise<ImageGenerateResponse> {
    const request: ImageGenerateRequest = {
      model: options.model || 'image-01',
      prompt,
      aspect_ratio: options.aspectRatio || '1:1',
      n: options.n || 1,
      prompt_optimizer: options.promptOptimizer ?? true,
    };

    return this.client.post<ImageGenerateResponse>('/image_generation', request);
  }

  async getStatus(taskId: string): Promise<ImageStatusResponse> {
    return this.client.get<ImageStatusResponse>('/query/image_generation', { task_id: taskId });
  }

  async download(fileId: string): Promise<Buffer> {
    const fileResponse = await this.client.get<{ file: { download_url: string } }>('/files/retrieve', { file_id: fileId });
    return this.client.downloadFile(fileResponse.file.download_url);
  }

  async generateAndWait(
    prompt: string,
    options: ImageOptions = {},
    pollIntervalMs = 3000,
    maxAttempts = 60
  ): Promise<{ fileId: string; downloadUrl: string }> {
    const job = await this.generate(prompt, options);
    const taskId = job.task_id;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      const status = await this.getStatus(taskId);

      if (status.status === 'Success' && status.file_id) {
        const fileResponse = await this.client.get<{ file: { download_url: string } }>('/files/retrieve', { file_id: status.file_id });
        return { fileId: status.file_id, downloadUrl: fileResponse.file.download_url };
      }

      if (status.status === 'Fail') {
        throw new Error(`Image generation failed: ${status.base_resp?.status_msg || 'Unknown error'}`);
      }
    }

    throw new Error('Image generation timed out');
  }
}

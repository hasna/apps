import type { MinimaxClient } from './client';
import type {
  VideoModel,
  VideoGenerateRequest,
  VideoGenerateResponse,
  VideoStatusResponse,
  VideoFileResponse,
} from '../types';

export interface VideoOptions {
  model?: VideoModel;
  firstFrameImage?: string;
  subjectReference?: string[];
  promptOptimizer?: boolean;
}

export class VideoApi {
  constructor(private readonly client: MinimaxClient) {}

  async generate(prompt: string, options: VideoOptions = {}): Promise<VideoGenerateResponse> {
    const request: VideoGenerateRequest = {
      model: options.model || 'T2V-01',
      prompt,
      prompt_optimizer: options.promptOptimizer ?? true,
    };

    if (options.firstFrameImage) {
      request.first_frame_image = options.firstFrameImage;
      request.model = options.model || 'I2V-01';
    }

    if (options.subjectReference) {
      request.subject_reference = options.subjectReference;
    }

    return this.client.post<VideoGenerateResponse>('/video_generation', request);
  }

  async getStatus(taskId: string): Promise<VideoStatusResponse> {
    return this.client.get<VideoStatusResponse>('/query/video_generation', { task_id: taskId });
  }

  async getFileUrl(fileId: string): Promise<string> {
    const response = await this.client.get<VideoFileResponse>('/files/retrieve', { file_id: fileId });
    return response.file.download_url;
  }

  async download(fileId: string): Promise<Buffer> {
    const url = await this.getFileUrl(fileId);
    return this.client.downloadFile(url);
  }

  async generateAndWait(
    prompt: string,
    options: VideoOptions = {},
    pollIntervalMs = 10000,
    maxAttempts = 120
  ): Promise<{ fileId: string; downloadUrl: string }> {
    const job = await this.generate(prompt, options);
    const taskId = job.task_id;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      const status = await this.getStatus(taskId);

      if (status.status === 'Success' && status.file_id) {
        const url = await this.getFileUrl(status.file_id);
        return { fileId: status.file_id, downloadUrl: url };
      }

      if (status.status === 'Fail') {
        throw new Error(`Video generation failed: ${status.base_resp?.status_msg || 'Unknown error'}`);
      }
    }

    throw new Error('Video generation timed out');
  }
}

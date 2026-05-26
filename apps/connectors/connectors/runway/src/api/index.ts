import type { RunwayConfig, ImageToVideoRequest, TextToVideoRequest, VideoTask, TaskResponse } from '../types';
import { RunwayClient } from './client';

export class Runway {
  private readonly client: RunwayClient;

  constructor(config: RunwayConfig) {
    this.client = new RunwayClient(config);
  }

  async imageToVideo(params: ImageToVideoRequest): Promise<TaskResponse> {
    return this.client.imageToVideo(params);
  }

  async textToVideo(params: TextToVideoRequest): Promise<TaskResponse> {
    return this.client.textToVideo(params);
  }

  async getTask(taskId: string): Promise<VideoTask> {
    return this.client.getTask(taskId);
  }

  async cancelTask(taskId: string): Promise<void> {
    return this.client.cancelTask(taskId);
  }

  static fromEnv(): Runway {
    const apiKey = process.env.RUNWAY_API_KEY || process.env.RUNWAYML_API_SECRET;
    if (!apiKey) {
      throw new Error('RUNWAY_API_KEY environment variable is required');
    }
    return new Runway({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { RunwayClient } from './client';

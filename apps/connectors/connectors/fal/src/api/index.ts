import type {
  FalConfig,
  ImageGenerateRequest,
  ImageGenerateResponse,
  QueueSubmitResponse,
  QueueStatusResponse,
  QueueResultResponse,
} from '../types';
import { FalClient } from './client';

export class Fal {
  private readonly client: FalClient;

  constructor(config: FalConfig) {
    this.client = new FalClient(config);
  }

  async run<T = ImageGenerateResponse>(model: string, input: Record<string, unknown>): Promise<T> {
    return this.client.run<T>(model, input);
  }

  async generateImage(model: string, params: ImageGenerateRequest): Promise<ImageGenerateResponse> {
    return this.client.generateImage(model, params);
  }

  async submit(model: string, input: Record<string, unknown>, webhookUrl?: string): Promise<QueueSubmitResponse> {
    return this.client.submit(model, input, webhookUrl);
  }

  async status(model: string, requestId: string): Promise<QueueStatusResponse> {
    return this.client.status(model, requestId);
  }

  async result<T = ImageGenerateResponse>(model: string, requestId: string): Promise<QueueResultResponse<T>> {
    return this.client.result<T>(model, requestId);
  }

  async cancel(model: string, requestId: string): Promise<void> {
    return this.client.cancel(model, requestId);
  }

  static fromEnv(): Fal {
    const apiKey = process.env.FAL_API_KEY;
    if (!apiKey) {
      throw new Error('FAL_API_KEY environment variable is required');
    }
    return new Fal({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { FalClient } from './client';

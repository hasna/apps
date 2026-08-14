import type {
  IdeogramConfig,
  GenerateRequest,
  GenerateResponse,
  DescribeRequest,
  DescribeResponse,
  RemixRequest,
  UpscaleRequest,
  UpscaleResponse,
} from '../types';
import { IdeogramClient } from './client';

export class Ideogram {
  private readonly client: IdeogramClient;

  constructor(config: IdeogramConfig) {
    this.client = new IdeogramClient(config);
  }

  async generate(params: GenerateRequest): Promise<GenerateResponse> {
    return this.client.generate(params);
  }

  async describe(params: DescribeRequest): Promise<DescribeResponse> {
    return this.client.describe(params);
  }

  async remix(params: RemixRequest): Promise<GenerateResponse> {
    return this.client.remix(params);
  }

  async upscale(params: UpscaleRequest): Promise<UpscaleResponse> {
    return this.client.upscale(params);
  }

  static fromEnv(): Ideogram {
    const apiKey = process.env.IDEOGRAM_API_KEY;
    if (!apiKey) {
      throw new Error('IDEOGRAM_API_KEY environment variable is required');
    }
    return new Ideogram({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { IdeogramClient } from './client';

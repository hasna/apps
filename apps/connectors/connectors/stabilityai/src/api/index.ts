import type { StabilityConfig } from '../types';
import { StabilityClient } from './client';
import { UserApi } from './user';
import { EnginesApi } from './engines';
import { TextToImageApi } from './text-to-image';
import { ImageToImageApi } from './image-to-image';
import { InpaintApi } from './inpaint';
import { OutpaintApi } from './outpaint';
import { UpscaleApi } from './upscale';
import { EditApi } from './edit';
import { ThreeDApi } from './3d';

/**
 * Stability AI API client
 * Provides access to all Stability AI API endpoints
 */
export class StabilityAI {
  private readonly client: StabilityClient;

  // API modules
  public readonly user: UserApi;
  public readonly engines: EnginesApi;
  public readonly textToImage: TextToImageApi;
  public readonly imageToImage: ImageToImageApi;
  public readonly inpaint: InpaintApi;
  public readonly outpaint: OutpaintApi;
  public readonly upscale: UpscaleApi;
  public readonly edit: EditApi;
  public readonly threeD: ThreeDApi;

  constructor(config: StabilityConfig) {
    this.client = new StabilityClient(config);
    this.user = new UserApi(this.client);
    this.engines = new EnginesApi(this.client);
    this.textToImage = new TextToImageApi(this.client);
    this.imageToImage = new ImageToImageApi(this.client);
    this.inpaint = new InpaintApi(this.client);
    this.outpaint = new OutpaintApi(this.client);
    this.upscale = new UpscaleApi(this.client);
    this.edit = new EditApi(this.client);
    this.threeD = new ThreeDApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for STABILITY_API_KEY
   */
  static fromEnv(): StabilityAI {
    const apiKey = process.env.STABILITY_API_KEY;

    if (!apiKey) {
      throw new Error('STABILITY_API_KEY environment variable is required');
    }
    return new StabilityAI({ apiKey });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): StabilityClient {
    return this.client;
  }
}

export { StabilityClient } from './client';
export { UserApi } from './user';
export { EnginesApi } from './engines';
export { TextToImageApi } from './text-to-image';
export { ImageToImageApi } from './image-to-image';
export { InpaintApi } from './inpaint';
export { OutpaintApi } from './outpaint';
export { UpscaleApi } from './upscale';
export { EditApi } from './edit';
export { ThreeDApi } from './3d';

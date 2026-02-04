import type { OpenAIClient } from './client';
import type {
  ImageGenerateRequest,
  ImageResponse,
  ImageOptions,
} from '../types';

/**
 * Images API (DALL-E)
 */
export class ImagesApi {
  constructor(private readonly client: OpenAIClient) {}

  /**
   * Generate images from a prompt
   */
  async generate(
    prompt: string,
    options: ImageOptions = {}
  ): Promise<ImageResponse> {
    const request: ImageGenerateRequest = {
      model: options.model || 'dall-e-3',
      prompt,
      n: options.n || 1,
      response_format: 'url',
    };

    if (options.size !== undefined) request.size = options.size;
    if (options.quality !== undefined) request.quality = options.quality;
    if (options.style !== undefined) request.style = options.style;

    return this.client.post<ImageResponse>('/images/generations', request);
  }

  /**
   * Generate a single image and return the URL
   */
  async createImage(
    prompt: string,
    options: Omit<ImageOptions, 'n'> = {}
  ): Promise<string> {
    const response = await this.generate(prompt, { ...options, n: 1 });
    const url = response.data[0]?.url;
    if (!url) {
      throw new Error('No image URL in response');
    }
    return url;
  }

  /**
   * Generate image and return base64 data
   */
  async createImageBase64(
    prompt: string,
    options: Omit<ImageOptions, 'n'> = {}
  ): Promise<string> {
    const request: ImageGenerateRequest = {
      model: options.model || 'dall-e-3',
      prompt,
      n: 1,
      response_format: 'b64_json',
    };

    if (options.size !== undefined) request.size = options.size;
    if (options.quality !== undefined) request.quality = options.quality;
    if (options.style !== undefined) request.style = options.style;

    const response = await this.client.post<ImageResponse>('/images/generations', request);
    const b64 = response.data[0]?.b64_json;
    if (!b64) {
      throw new Error('No image data in response');
    }
    return b64;
  }
}

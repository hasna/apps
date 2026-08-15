import type { OpenAIClient } from './client';
import type {
  ImageGenerateRequest,
  ImageResponse,
  ImageOptions,
} from '../types';

/** Models that use the new gpt-image API (different params than DALL-E) */
const GPT_IMAGE_MODELS = ['gpt-image-1'];

function isGptImage(model: string): boolean {
  return GPT_IMAGE_MODELS.some((m) => model.startsWith(m));
}

/**
 * Images API — supports both DALL-E 3 and gpt-image-1
 *
 * gpt-image-1 differences:
 *   - Uses `output_format` instead of `response_format`
 *   - Does NOT support `style` parameter
 *   - Does NOT support `response_format` parameter
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
    const model = options.model || 'dall-e-3';

    if (isGptImage(model)) {
      // gpt-image-1: different parameter set
      const request: Record<string, unknown> = {
        model,
        prompt,
        n: options.n || 1,
      };
      if (options.size !== undefined) request.size = options.size;
      if (options.quality !== undefined) request.quality = options.quality;
      // gpt-image-1 uses output_format, not response_format. No style param.
      request.output_format = 'url';
      return this.client.post<ImageResponse>('/images/generations', request);
    }

    // DALL-E 3: original parameter set
    const request: ImageGenerateRequest = {
      model,
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
    const model = options.model || 'dall-e-3';

    if (isGptImage(model)) {
      const request: Record<string, unknown> = {
        model,
        prompt,
        n: 1,
        output_format: 'b64_json',
      };
      if (options.size !== undefined) request.size = options.size;
      if (options.quality !== undefined) request.quality = options.quality;

      const response = await this.client.post<ImageResponse>('/images/generations', request);
      const b64 = response.data[0]?.b64_json;
      if (!b64) throw new Error('No image data in response');
      return b64;
    }

    // DALL-E 3
    const request: ImageGenerateRequest = {
      model,
      prompt,
      n: 1,
      response_format: 'b64_json',
    };
    if (options.size !== undefined) request.size = options.size;
    if (options.quality !== undefined) request.quality = options.quality;
    if (options.style !== undefined) request.style = options.style;

    const response = await this.client.post<ImageResponse>('/images/generations', request);
    const b64 = response.data[0]?.b64_json;
    if (!b64) throw new Error('No image data in response');
    return b64;
  }
}

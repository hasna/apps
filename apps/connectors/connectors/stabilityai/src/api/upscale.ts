import type { UpscaleOptions, UpscaleResponse } from '../types';
import { StabilityClient } from './client';

/**
 * Upscale API
 * Increase image resolution with AI enhancement
 */
export class UpscaleApi {
  constructor(private readonly client: StabilityClient) {}

  /**
   * Conservative upscale - maintains fidelity to original (v2 API)
   * Best for preserving details without major changes
   */
  async conservative(options: UpscaleOptions): Promise<UpscaleResponse> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('image', imageBlob, 'image.png');

    if (options.prompt) {
      formData.append('prompt', options.prompt);
    }
    if (options.negativePrompt) {
      formData.append('negative_prompt', options.negativePrompt);
    }
    if (options.outputFormat) {
      formData.append('output_format', options.outputFormat);
    }
    if (options.seed !== undefined) {
      formData.append('seed', options.seed.toString());
    }
    if (options.creativity !== undefined) {
      formData.append('creativity', options.creativity.toString());
    }

    return this.client.requestMultipart<UpscaleResponse>(
      '/stable-image/upscale/conservative',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Creative upscale - allows more creative enhancement (v2 API)
   * Can add details and improve quality more aggressively
   */
  async creative(options: UpscaleOptions): Promise<UpscaleResponse> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('image', imageBlob, 'image.png');

    // Creative upscale requires a prompt
    formData.append('prompt', options.prompt || 'high quality, detailed');

    if (options.negativePrompt) {
      formData.append('negative_prompt', options.negativePrompt);
    }
    if (options.outputFormat) {
      formData.append('output_format', options.outputFormat);
    }
    if (options.seed !== undefined) {
      formData.append('seed', options.seed.toString());
    }
    if (options.creativity !== undefined) {
      formData.append('creativity', options.creativity.toString());
    }

    return this.client.requestMultipart<UpscaleResponse>(
      '/stable-image/upscale/creative',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Fast upscale - quick 4x upscale (v2 API)
   * Fastest option, less enhancement
   */
  async fast(options: UpscaleOptions): Promise<UpscaleResponse> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('image', imageBlob, 'image.png');

    if (options.outputFormat) {
      formData.append('output_format', options.outputFormat);
    }

    return this.client.requestMultipart<UpscaleResponse>(
      '/stable-image/upscale/fast',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Upscale image using the specified mode
   * @param mode - 'conservative', 'creative', or 'fast'
   */
  async upscale(options: UpscaleOptions, mode: 'conservative' | 'creative' | 'fast' = 'conservative'): Promise<UpscaleResponse> {
    switch (mode) {
      case 'creative':
        return this.creative(options);
      case 'fast':
        return this.fast(options);
      case 'conservative':
      default:
        return this.conservative(options);
    }
  }
}

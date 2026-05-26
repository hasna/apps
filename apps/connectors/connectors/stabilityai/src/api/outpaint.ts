import type { OutpaintOptions, OutpaintResponse } from '../types';
import { StabilityClient } from './client';

/**
 * Outpainting API
 * Extend image boundaries with AI-generated content
 */
export class OutpaintApi {
  constructor(private readonly client: StabilityClient) {}

  /**
   * Extend image boundaries (v2 API)
   *
   * @param options - Outpaint options including image and extension amounts
   * @returns The extended image
   */
  async outpaint(options: OutpaintOptions): Promise<OutpaintResponse> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('image', imageBlob, 'image.png');

    // At least one direction must be specified
    if (options.left !== undefined) {
      formData.append('left', options.left.toString());
    }
    if (options.right !== undefined) {
      formData.append('right', options.right.toString());
    }
    if (options.up !== undefined) {
      formData.append('up', options.up.toString());
    }
    if (options.down !== undefined) {
      formData.append('down', options.down.toString());
    }

    if (options.prompt) {
      formData.append('prompt', options.prompt);
    }
    if (options.negativePrompt) {
      formData.append('negative_prompt', options.negativePrompt);
    }
    if (options.creativity !== undefined) {
      formData.append('creativity', options.creativity.toString());
    }
    if (options.seed !== undefined) {
      formData.append('seed', options.seed.toString());
    }
    if (options.outputFormat) {
      formData.append('output_format', options.outputFormat);
    }

    return this.client.requestMultipart<OutpaintResponse>(
      '/stable-image/edit/outpaint',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Extend image to the left
   */
  async extendLeft(image: string | Buffer, pixels: number, options: Partial<OutpaintOptions> = {}): Promise<OutpaintResponse> {
    return this.outpaint({
      ...options,
      image,
      left: pixels,
    });
  }

  /**
   * Extend image to the right
   */
  async extendRight(image: string | Buffer, pixels: number, options: Partial<OutpaintOptions> = {}): Promise<OutpaintResponse> {
    return this.outpaint({
      ...options,
      image,
      right: pixels,
    });
  }

  /**
   * Extend image upward
   */
  async extendUp(image: string | Buffer, pixels: number, options: Partial<OutpaintOptions> = {}): Promise<OutpaintResponse> {
    return this.outpaint({
      ...options,
      image,
      up: pixels,
    });
  }

  /**
   * Extend image downward
   */
  async extendDown(image: string | Buffer, pixels: number, options: Partial<OutpaintOptions> = {}): Promise<OutpaintResponse> {
    return this.outpaint({
      ...options,
      image,
      down: pixels,
    });
  }

  /**
   * Extend image in all directions equally
   */
  async extendAll(image: string | Buffer, pixels: number, options: Partial<OutpaintOptions> = {}): Promise<OutpaintResponse> {
    return this.outpaint({
      ...options,
      image,
      left: pixels,
      right: pixels,
      up: pixels,
      down: pixels,
    });
  }
}

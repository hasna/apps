import type { ImageToImageOptions, ImageToImageResponse, GenerationArtifact } from '../types';
import { StabilityClient } from './client';

/**
 * Image-to-Image API
 * Transform existing images using AI
 */
export class ImageToImageApi {
  constructor(private readonly client: StabilityClient) {}

  /**
   * Transform image using Stable Diffusion 3.5 (v2 API)
   */
  async transformSD3(options: ImageToImageOptions): Promise<ImageToImageResponse> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('image', imageBlob, 'image.png');
    formData.append('prompt', options.prompt);

    if (options.negativePrompt) {
      formData.append('negative_prompt', options.negativePrompt);
    }
    if (options.strength !== undefined) {
      formData.append('strength', options.strength.toString());
    }
    if (options.seed !== undefined) {
      formData.append('seed', options.seed.toString());
    }
    if (options.outputFormat) {
      formData.append('output_format', options.outputFormat);
    }
    if (options.model) {
      formData.append('model', options.model);
    }
    if (options.mode) {
      formData.append('mode', options.mode);
    }

    return this.client.requestMultipart<ImageToImageResponse>(
      '/stable-image/generate/sd3',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Transform image using Stable Image Core (v2 API)
   */
  async transformCore(options: ImageToImageOptions): Promise<ImageToImageResponse> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('image', imageBlob, 'image.png');
    formData.append('prompt', options.prompt);

    if (options.negativePrompt) {
      formData.append('negative_prompt', options.negativePrompt);
    }
    if (options.strength !== undefined) {
      formData.append('strength', options.strength.toString());
    }
    if (options.seed !== undefined) {
      formData.append('seed', options.seed.toString());
    }
    if (options.outputFormat) {
      formData.append('output_format', options.outputFormat);
    }
    if (options.stylePreset) {
      formData.append('style_preset', options.stylePreset);
    }

    return this.client.requestMultipart<ImageToImageResponse>(
      '/stable-image/generate/core',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Transform image using SDXL 1.0 (v1 API)
   */
  async transformSDXL(options: ImageToImageOptions): Promise<{ artifacts: GenerationArtifact[] }> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('init_image', imageBlob, 'image.png');
    formData.append('text_prompts[0][text]', options.prompt);
    formData.append('text_prompts[0][weight]', '1');

    if (options.negativePrompt) {
      formData.append('text_prompts[1][text]', options.negativePrompt);
      formData.append('text_prompts[1][weight]', '-1');
    }
    if (options.strength !== undefined) {
      // V1 uses image_strength which is inverse of strength
      formData.append('image_strength', (1 - options.strength).toString());
    }
    if (options.cfgScale !== undefined) {
      formData.append('cfg_scale', options.cfgScale.toString());
    }
    if (options.samples !== undefined) {
      formData.append('samples', options.samples.toString());
    }
    if (options.steps !== undefined) {
      formData.append('steps', options.steps.toString());
    }
    if (options.seed !== undefined) {
      formData.append('seed', options.seed.toString());
    }
    if (options.stylePreset) {
      formData.append('style_preset', options.stylePreset);
    }

    const engineId = options.model || 'stable-diffusion-xl-1024-v1-0';
    return this.client.requestMultipart<{ artifacts: GenerationArtifact[] }>(
      `/generation/${engineId}/image-to-image`,
      formData,
      { version: 'v1' }
    );
  }

  /**
   * Transform image using the default/recommended method
   */
  async transform(options: ImageToImageOptions): Promise<ImageToImageResponse> {
    const model = options.model || 'sd3.5-large';

    // Route to appropriate API based on model
    if (model.startsWith('stable-diffusion-xl') || model.startsWith('sdxl')) {
      const result = await this.transformSDXL(options);
      // Convert v1 response format to v2 format
      if (result.artifacts && result.artifacts.length > 0) {
        return {
          image: result.artifacts[0].base64,
          seed: result.artifacts[0].seed,
          finish_reason: result.artifacts[0].finishReason,
        };
      }
      return result;
    }

    if (model === 'core') {
      return this.transformCore(options);
    }

    // Default to SD3
    return this.transformSD3({ ...options, model });
  }
}

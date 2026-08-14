import type { InpaintOptions, InpaintResponse, GenerationArtifact } from '../types';
import { StabilityClient } from './client';

/**
 * Inpainting API
 * Fill in masked areas of images with AI-generated content
 */
export class InpaintApi {
  constructor(private readonly client: StabilityClient) {}

  /**
   * Inpaint image using Stable Diffusion 3.5 (v2 API)
   */
  async inpaintSD3(options: InpaintOptions): Promise<InpaintResponse> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('image', imageBlob, 'image.png');

    const maskBlob = StabilityClient.createImageBlob(options.mask);
    formData.append('mask', maskBlob, 'mask.png');

    formData.append('prompt', options.prompt);

    if (options.negativePrompt) {
      formData.append('negative_prompt', options.negativePrompt);
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
    if (options.growMask !== undefined) {
      formData.append('grow_mask', options.growMask.toString());
    }

    // Mode for inpainting
    formData.append('mode', 'image-to-image-masking');

    return this.client.requestMultipart<InpaintResponse>(
      '/stable-image/generate/sd3',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Inpaint using Stable Image Core (v2 API)
   */
  async inpaintCore(options: InpaintOptions): Promise<InpaintResponse> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('image', imageBlob, 'image.png');

    const maskBlob = StabilityClient.createImageBlob(options.mask);
    formData.append('mask', maskBlob, 'mask.png');

    formData.append('prompt', options.prompt);

    if (options.negativePrompt) {
      formData.append('negative_prompt', options.negativePrompt);
    }
    if (options.seed !== undefined) {
      formData.append('seed', options.seed.toString());
    }
    if (options.outputFormat) {
      formData.append('output_format', options.outputFormat);
    }
    if (options.growMask !== undefined) {
      formData.append('grow_mask', options.growMask.toString());
    }

    return this.client.requestMultipart<InpaintResponse>(
      '/stable-image/edit/inpaint',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Inpaint using SDXL 1.0 (v1 API)
   */
  async inpaintSDXL(options: InpaintOptions): Promise<{ artifacts: GenerationArtifact[] }> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('init_image', imageBlob, 'image.png');

    const maskBlob = StabilityClient.createImageBlob(options.mask);
    formData.append('mask_image', maskBlob, 'mask.png');

    formData.append('text_prompts[0][text]', options.prompt);
    formData.append('text_prompts[0][weight]', '1');
    formData.append('mask_source', 'MASK_IMAGE_BLACK');

    if (options.negativePrompt) {
      formData.append('text_prompts[1][text]', options.negativePrompt);
      formData.append('text_prompts[1][weight]', '-1');
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

    const engineId = options.model || 'stable-diffusion-xl-1024-v1-0';
    return this.client.requestMultipart<{ artifacts: GenerationArtifact[] }>(
      `/generation/${engineId}/image-to-image/masking`,
      formData,
      { version: 'v1' }
    );
  }

  /**
   * Inpaint image using the default/recommended method
   */
  async inpaint(options: InpaintOptions): Promise<InpaintResponse> {
    const model = options.model || 'sd3.5-large';

    // Route to appropriate API based on model
    if (model.startsWith('stable-diffusion-xl') || model.startsWith('sdxl')) {
      const result = await this.inpaintSDXL(options);
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
      return this.inpaintCore(options);
    }

    // Default to SD3
    return this.inpaintSD3({ ...options, model });
  }
}

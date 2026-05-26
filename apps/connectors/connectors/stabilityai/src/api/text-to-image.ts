import type { TextToImageOptions, TextToImageResponse, GenerationArtifact } from '../types';
import { StabilityClient } from './client';

/**
 * Text-to-Image API
 * Generate images from text prompts
 */
export class TextToImageApi {
  constructor(private readonly client: StabilityClient) {}

  /**
   * Generate image using Stable Diffusion 3.5 (v2 API)
   * Models: sd3.5-large, sd3.5-large-turbo, sd3.5-medium, sd3-large, sd3-large-turbo, sd3-medium
   */
  async generateSD3(options: TextToImageOptions): Promise<TextToImageResponse> {
    const formData = new FormData();

    formData.append('prompt', options.prompt);

    if (options.negativePrompt) {
      formData.append('negative_prompt', options.negativePrompt);
    }
    if (options.aspectRatio) {
      formData.append('aspect_ratio', options.aspectRatio);
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

    return this.client.requestMultipart<TextToImageResponse>(
      '/stable-image/generate/sd3',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Generate image using Stable Image Core (v2 API)
   * Fast, high-quality generation
   */
  async generateCore(options: TextToImageOptions): Promise<TextToImageResponse> {
    const formData = new FormData();

    formData.append('prompt', options.prompt);

    if (options.negativePrompt) {
      formData.append('negative_prompt', options.negativePrompt);
    }
    if (options.aspectRatio) {
      formData.append('aspect_ratio', options.aspectRatio);
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

    return this.client.requestMultipart<TextToImageResponse>(
      '/stable-image/generate/core',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Generate image using Stable Image Ultra (v2 API)
   * Highest quality, more expensive
   */
  async generateUltra(options: TextToImageOptions): Promise<TextToImageResponse> {
    const formData = new FormData();

    formData.append('prompt', options.prompt);

    if (options.negativePrompt) {
      formData.append('negative_prompt', options.negativePrompt);
    }
    if (options.aspectRatio) {
      formData.append('aspect_ratio', options.aspectRatio);
    }
    if (options.seed !== undefined) {
      formData.append('seed', options.seed.toString());
    }
    if (options.outputFormat) {
      formData.append('output_format', options.outputFormat);
    }

    return this.client.requestMultipart<TextToImageResponse>(
      '/stable-image/generate/ultra',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Generate image using SDXL 1.0 (v1 API)
   */
  async generateSDXL(options: TextToImageOptions): Promise<{ artifacts: GenerationArtifact[] }> {
    const body: Record<string, unknown> = {
      text_prompts: [{ text: options.prompt, weight: 1 }],
    };

    if (options.negativePrompt) {
      body.text_prompts = [
        { text: options.prompt, weight: 1 },
        { text: options.negativePrompt, weight: -1 },
      ];
    }
    if (options.cfgScale !== undefined) {
      body.cfg_scale = options.cfgScale;
    }
    if (options.height !== undefined) {
      body.height = options.height;
    }
    if (options.width !== undefined) {
      body.width = options.width;
    }
    if (options.samples !== undefined) {
      body.samples = options.samples;
    }
    if (options.steps !== undefined) {
      body.steps = options.steps;
    }
    if (options.seed !== undefined) {
      body.seed = options.seed;
    }
    if (options.stylePreset) {
      body.style_preset = options.stylePreset;
    }

    const engineId = options.model || 'stable-diffusion-xl-1024-v1-0';
    return this.client.post<{ artifacts: GenerationArtifact[] }>(
      `/generation/${engineId}/text-to-image`,
      body,
      undefined,
      'v1'
    );
  }

  /**
   * Generate image using the default/recommended method
   * Currently uses Stable Diffusion 3.5 Large
   */
  async generate(options: TextToImageOptions): Promise<TextToImageResponse> {
    const model = options.model || 'sd3.5-large';

    // Route to appropriate API based on model
    if (model.startsWith('stable-diffusion-xl') || model.startsWith('sdxl')) {
      const result = await this.generateSDXL(options);
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
      return this.generateCore(options);
    }

    if (model === 'ultra') {
      return this.generateUltra(options);
    }

    // Default to SD3
    return this.generateSD3({ ...options, model });
  }
}

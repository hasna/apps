import type { GeminiClient } from './client';
import type { ModelInfo, GeminiModel, VeoModel } from '../types';

export interface ListModelsResponse {
  models: ModelInfo[];
  nextPageToken?: string;
}

/**
 * Models API
 */
export class ModelsApi {
  constructor(private client: GeminiClient) {}

  /**
   * List all available models
   */
  async list(pageSize?: number, pageToken?: string): Promise<ListModelsResponse> {
    return this.client.get<ListModelsResponse>('/models', {
      pageSize,
      pageToken,
    });
  }

  /**
   * Get model info
   */
  async get(modelName: string): Promise<ModelInfo> {
    const name = modelName.startsWith('models/') ? modelName : `models/${modelName}`;
    return this.client.get<ModelInfo>(`/${name}`);
  }

  /**
   * Get recommended text generation models
   */
  getTextModels(): GeminiModel[] {
    return [
      'gemini-3-pro-preview',
      'gemini-3-flash-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ];
  }

  /**
   * Get image generation models (Nano Banana)
   */
  getImageModels(): GeminiModel[] {
    return [
      'gemini-2.5-flash-preview-image-generation',
      'gemini-3-pro-image-preview',
    ];
  }

  /**
   * Get video generation models (Veo)
   */
  getVideoModels(): VeoModel[] {
    return [
      'veo-3.1-generate-preview',
      'veo-3.1-fast-generate-preview',
      'veo-2.0-generate-001',
    ];
  }

  /**
   * Get TTS models
   */
  getTTSModels(): GeminiModel[] {
    return [
      'gemini-2.5-flash-preview-tts',
      'gemini-2.5-pro-preview-tts',
    ];
  }

  /**
   * Get embedding models
   */
  getEmbeddingModels(): GeminiModel[] {
    return ['gemini-embedding-001'];
  }

  /**
   * Get all available models by category
   */
  getAllModels(): {
    text: GeminiModel[];
    image: GeminiModel[];
    video: VeoModel[];
    tts: GeminiModel[];
    embedding: GeminiModel[];
  } {
    return {
      text: this.getTextModels(),
      image: this.getImageModels(),
      video: this.getVideoModels(),
      tts: this.getTTSModels(),
      embedding: this.getEmbeddingModels(),
    };
  }
}

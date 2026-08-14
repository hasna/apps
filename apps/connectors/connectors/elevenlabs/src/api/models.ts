import type { ElevenLabsClient } from './client';
import type { Model } from '../types';

/**
 * Models API module
 * List available models and their capabilities
 */
export class ModelsApi {
  constructor(private readonly client: ElevenLabsClient) {}

  /**
   * List all available models
   */
  async list(): Promise<Model[]> {
    return this.client.get<Model[]>('/v1/models');
  }

  /**
   * Get a specific model by ID
   */
  async get(modelId: string): Promise<Model | undefined> {
    const models = await this.list();
    return models.find(m => m.model_id === modelId);
  }

  /**
   * Get models that support TTS
   */
  async getTTSModels(): Promise<Model[]> {
    const models = await this.list();
    return models.filter(m => m.can_do_text_to_speech);
  }

  /**
   * Get models that support voice conversion (STS)
   */
  async getSTSModels(): Promise<Model[]> {
    const models = await this.list();
    return models.filter(m => m.can_do_voice_conversion);
  }

  /**
   * Get models that can be fine-tuned
   */
  async getFineTunableModels(): Promise<Model[]> {
    const models = await this.list();
    return models.filter(m => m.can_be_finetuned);
  }
}

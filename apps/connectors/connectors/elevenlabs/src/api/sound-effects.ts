import type { ElevenLabsClient } from './client';
import type { SoundEffectRequest, AudioFormat } from '../types';
import { DEFAULT_AUDIO_FORMAT } from '../types';

/**
 * Sound Effects API module
 * Generate sound effects from text descriptions
 */
export class SoundEffectsApi {
  constructor(private readonly client: ElevenLabsClient) {}

  /**
   * Generate a sound effect from text description
   */
  async generate(
    text: string,
    options?: {
      durationSeconds?: number;
      promptInfluence?: number;
      outputFormat?: AudioFormat;
    }
  ): Promise<ArrayBuffer> {
    const body: SoundEffectRequest = {
      text,
      duration_seconds: options?.durationSeconds,
      prompt_influence: options?.promptInfluence,
    };

    const params: Record<string, string | number | boolean | undefined> = {
      output_format: options?.outputFormat || DEFAULT_AUDIO_FORMAT,
    };

    return this.client.post<ArrayBuffer>(
      '/v1/sound-generation',
      body,
      params,
      { responseType: 'arraybuffer' }
    );
  }

  /**
   * Generate multiple variations of a sound effect
   */
  async generateVariations(
    text: string,
    count: number = 3,
    options?: {
      durationSeconds?: number;
      promptInfluence?: number;
      outputFormat?: AudioFormat;
    }
  ): Promise<ArrayBuffer[]> {
    const results: ArrayBuffer[] = [];

    for (let i = 0; i < count; i++) {
      const audio = await this.generate(text, options);
      results.push(audio);
    }

    return results;
  }
}

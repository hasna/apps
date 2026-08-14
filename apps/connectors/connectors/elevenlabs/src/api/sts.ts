import type { ElevenLabsClient } from './client';
import type { STSRequest, STSModelId, AudioFormat, VoiceSettings } from '../types';
import { DEFAULT_AUDIO_FORMAT } from '../types';

/**
 * Speech-to-Speech API module
 * Voice conversion - transform one voice into another
 */
export class STSApi {
  constructor(private readonly client: ElevenLabsClient) {}

  /**
   * Convert speech from one voice to another
   */
  async convert(
    voiceId: string,
    audioFile: File | Blob,
    options?: {
      modelId?: STSModelId;
      voiceSettings?: VoiceSettings;
      seed?: number;
      removeBackgroundNoise?: boolean;
      outputFormat?: AudioFormat;
    }
  ): Promise<ArrayBuffer> {
    const formData = new FormData();
    formData.append('audio', audioFile);

    if (options?.modelId) {
      formData.append('model_id', options.modelId);
    }
    if (options?.voiceSettings) {
      formData.append('voice_settings', JSON.stringify(options.voiceSettings));
    }
    if (options?.seed !== undefined) {
      formData.append('seed', String(options.seed));
    }
    if (options?.removeBackgroundNoise !== undefined) {
      formData.append('remove_background_noise', String(options.removeBackgroundNoise));
    }

    const params: Record<string, string | number | boolean | undefined> = {
      output_format: options?.outputFormat || DEFAULT_AUDIO_FORMAT,
    };

    return this.client.post<ArrayBuffer>(
      `/v1/speech-to-speech/${voiceId}`,
      formData,
      params,
      { responseType: 'arraybuffer' }
    );
  }

  /**
   * Convert speech with streaming
   */
  async stream(
    voiceId: string,
    audioFile: File | Blob,
    options?: {
      modelId?: STSModelId;
      voiceSettings?: VoiceSettings;
      removeBackgroundNoise?: boolean;
      outputFormat?: AudioFormat;
    }
  ): Promise<ArrayBuffer> {
    const formData = new FormData();
    formData.append('audio', audioFile);

    if (options?.modelId) {
      formData.append('model_id', options.modelId);
    }
    if (options?.voiceSettings) {
      formData.append('voice_settings', JSON.stringify(options.voiceSettings));
    }
    if (options?.removeBackgroundNoise !== undefined) {
      formData.append('remove_background_noise', String(options.removeBackgroundNoise));
    }

    const params: Record<string, string | number | boolean | undefined> = {
      output_format: options?.outputFormat || DEFAULT_AUDIO_FORMAT,
    };

    return this.client.post<ArrayBuffer>(
      `/v1/speech-to-speech/${voiceId}/stream`,
      formData,
      params,
      { responseType: 'arraybuffer' }
    );
  }

  /**
   * Get available models for STS
   */
  getAvailableModels(): { id: STSModelId; name: string; description: string }[] {
    return [
      {
        id: 'eleven_multilingual_sts_v2',
        name: 'Eleven Multilingual STS v2',
        description: 'Multilingual voice conversion, 29 languages',
      },
      {
        id: 'eleven_english_sts_v2',
        name: 'Eleven English STS v2',
        description: 'English-only voice conversion',
      },
    ];
  }
}

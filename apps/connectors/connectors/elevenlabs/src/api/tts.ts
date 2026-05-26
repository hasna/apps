import type { ElevenLabsClient } from './client';
import type {
  TTSRequest,
  TTSOptions,
  TTSModelId,
  AudioFormat,
  VoiceSettings,
} from '../types';
import { DEFAULT_TTS_MODEL, DEFAULT_AUDIO_FORMAT, DEFAULT_VOICE_SETTINGS } from '../types';

/**
 * Text-to-Speech API module
 * Convert text to speech using various models
 */
export class TTSApi {
  constructor(private readonly client: ElevenLabsClient) {}

  /**
   * Convert text to speech
   * Returns audio as ArrayBuffer
   */
  async convert(
    voiceId: string,
    text: string,
    options?: {
      modelId?: TTSModelId;
      outputFormat?: AudioFormat;
      voiceSettings?: VoiceSettings;
      languageCode?: string;
      seed?: number;
      previousText?: string;
      nextText?: string;
      optimizeStreamingLatency?: 0 | 1 | 2 | 3 | 4;
    }
  ): Promise<ArrayBuffer> {
    const body: TTSRequest = {
      text,
      model_id: options?.modelId || DEFAULT_TTS_MODEL,
      voice_settings: options?.voiceSettings,
      language_code: options?.languageCode,
      seed: options?.seed,
      previous_text: options?.previousText,
      next_text: options?.nextText,
    };

    const params: Record<string, string | number | boolean | undefined> = {
      output_format: options?.outputFormat || DEFAULT_AUDIO_FORMAT,
      optimize_streaming_latency: options?.optimizeStreamingLatency,
    };

    return this.client.post<ArrayBuffer>(
      `/v1/text-to-speech/${voiceId}`,
      body,
      params,
      { responseType: 'arraybuffer' }
    );
  }

  /**
   * Convert text to speech with streaming
   * Returns audio as ArrayBuffer (streamed response)
   */
  async stream(
    voiceId: string,
    text: string,
    options?: {
      modelId?: TTSModelId;
      outputFormat?: AudioFormat;
      voiceSettings?: VoiceSettings;
      languageCode?: string;
      optimizeStreamingLatency?: 0 | 1 | 2 | 3 | 4;
    }
  ): Promise<ArrayBuffer> {
    const body: TTSRequest = {
      text,
      model_id: options?.modelId || DEFAULT_TTS_MODEL,
      voice_settings: options?.voiceSettings,
      language_code: options?.languageCode,
    };

    const params: Record<string, string | number | boolean | undefined> = {
      output_format: options?.outputFormat || DEFAULT_AUDIO_FORMAT,
      optimize_streaming_latency: options?.optimizeStreamingLatency ?? 3,
    };

    return this.client.post<ArrayBuffer>(
      `/v1/text-to-speech/${voiceId}/stream`,
      body,
      params,
      { responseType: 'arraybuffer' }
    );
  }

  /**
   * Convert text to speech with timestamps
   * Returns audio + character-level timestamps
   */
  async convertWithTimestamps(
    voiceId: string,
    text: string,
    options?: {
      modelId?: TTSModelId;
      outputFormat?: AudioFormat;
      voiceSettings?: VoiceSettings;
      languageCode?: string;
    }
  ): Promise<{
    audio_base64: string;
    alignment: {
      characters: string[];
      character_start_times_seconds: number[];
      character_end_times_seconds: number[];
    };
    normalized_alignment?: {
      characters: string[];
      character_start_times_seconds: number[];
      character_end_times_seconds: number[];
    };
  }> {
    const body: TTSRequest = {
      text,
      model_id: options?.modelId || DEFAULT_TTS_MODEL,
      voice_settings: options?.voiceSettings,
      language_code: options?.languageCode,
    };

    const params: Record<string, string | number | boolean | undefined> = {
      output_format: options?.outputFormat || DEFAULT_AUDIO_FORMAT,
    };

    return this.client.post(
      `/v1/text-to-speech/${voiceId}/with-timestamps`,
      body,
      params
    );
  }

  /**
   * Get available models for TTS
   */
  getAvailableModels(): { id: TTSModelId; name: string; description: string }[] {
    return [
      {
        id: 'eleven_v3',
        name: 'Eleven v3',
        description: 'Latest model - most expressive, 70+ languages, 5k char limit',
      },
      {
        id: 'eleven_multilingual_v2',
        name: 'Eleven Multilingual v2',
        description: 'Stable for long-form, 29 languages, 10k char limit',
      },
      {
        id: 'eleven_flash_v2_5',
        name: 'Eleven Flash v2.5',
        description: 'Ultra-low latency (~75ms), 32 languages, 40k char limit',
      },
      {
        id: 'eleven_flash_v2',
        name: 'Eleven Flash v2',
        description: 'Ultra-low latency (~75ms), English only, 30k char limit',
      },
      {
        id: 'eleven_turbo_v2_5',
        name: 'Eleven Turbo v2.5',
        description: 'Balanced quality/speed (~250ms), 32 languages, 40k char limit',
      },
      {
        id: 'eleven_turbo_v2',
        name: 'Eleven Turbo v2',
        description: 'Balanced quality/speed (~250ms), English only, 30k char limit',
      },
    ];
  }
}

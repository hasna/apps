import type {
  MurfConfig,
  VoicesListResponse,
  Voice,
  GenerateSpeechOptions,
  GenerateSpeechResponse,
  LanguagesListResponse,
} from '../types';
import { MurfClient } from './client';

/**
 * Murf AI API Client
 * Text-to-speech API with natural voices
 */
export class Murf {
  private readonly client: MurfClient;

  constructor(config: MurfConfig) {
    this.client = new MurfClient(config);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): Murf {
    const apiKey = process.env.MURF_API_KEY;

    if (!apiKey) {
      throw new Error('MURF_API_KEY environment variable is required');
    }
    return new Murf({ apiKey });
  }

  // ============================================
  // Voice Methods
  // ============================================

  /**
   * List all available voices
   */
  async listVoices(options?: {
    language?: string;
    gender?: 'male' | 'female';
  }): Promise<Voice[]> {
    const params: Record<string, string | undefined> = {};
    if (options?.language) params.language = options.language;
    if (options?.gender) params.gender = options.gender;

    const response = await this.client.get<VoicesListResponse>('/speech/voices', params);
    return response.voices;
  }

  /**
   * Get a specific voice by ID
   */
  async getVoice(voiceId: string): Promise<Voice | undefined> {
    const voices = await this.listVoices();
    return voices.find(v => v.voice_id === voiceId);
  }

  // ============================================
  // Language Methods
  // ============================================

  /**
   * List all available languages
   */
  async listLanguages(): Promise<LanguagesListResponse> {
    return this.client.get<LanguagesListResponse>('/speech/languages');
  }

  // ============================================
  // Speech Generation Methods
  // ============================================

  /**
   * Generate speech from text
   */
  async generateSpeech(options: GenerateSpeechOptions): Promise<GenerateSpeechResponse> {
    return this.client.post<GenerateSpeechResponse>('/speech/generate', {
      voiceId: options.voice_id,
      text: options.text,
      format: options.format || 'mp3',
      sampleRate: options.sample_rate,
      speed: options.speed,
      pitch: options.pitch,
      style: options.style,
      modelVersion: options.model_version,
    });
  }

  /**
   * Generate speech and return audio as Buffer
   */
  async speak(text: string, voiceId: string, options?: {
    format?: 'mp3' | 'wav' | 'flac' | 'aac';
    speed?: number;
    pitch?: number;
    style?: string;
  }): Promise<{ audio: Buffer; audioUrl: string; duration?: number }> {
    const result = await this.generateSpeech({
      voice_id: voiceId,
      text,
      format: options?.format || 'mp3',
      speed: options?.speed,
      pitch: options?.pitch,
      style: options?.style,
    });

    // If encoded_audio is provided, use that
    if (result.encoded_audio) {
      return {
        audio: Buffer.from(result.encoded_audio, 'base64'),
        audioUrl: result.audio_file,
        duration: result.duration_seconds,
      };
    }

    // Otherwise download from URL
    if (result.audio_file) {
      const response = await fetch(result.audio_file);
      const buffer = await response.arrayBuffer();
      return {
        audio: Buffer.from(buffer),
        audioUrl: result.audio_file,
        duration: result.duration_seconds,
      };
    }

    throw new Error('No audio data in response');
  }

  /**
   * Get a preview of the API key
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): MurfClient {
    return this.client;
  }
}

export { MurfClient } from './client';

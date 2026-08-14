import type {
  SpeechifyConfig,
  VoicesListResponse,
  VoiceResponse,
  Voice,
  GenerateSpeechOptions,
  GenerateSpeechResponse,
  CloneVoiceOptions,
  CloneVoiceResponse,
  DeleteVoiceResponse,
  UsageResponse,
} from '../types';
import { SpeechifyClient } from './client';

/**
 * Speechify API Client
 * Text-to-speech API with voice cloning support
 */
export class Speechify {
  private readonly client: SpeechifyClient;

  constructor(config: SpeechifyConfig) {
    this.client = new SpeechifyClient(config);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): Speechify {
    const apiKey = process.env.SPEECHIFY_API_KEY;

    if (!apiKey) {
      throw new Error('SPEECHIFY_API_KEY environment variable is required');
    }
    return new Speechify({ apiKey });
  }

  // ============================================
  // Voice Methods
  // ============================================

  /**
   * List all available voices
   */
  async listVoices(): Promise<VoicesListResponse> {
    return this.client.get<VoicesListResponse>('/voices');
  }

  /**
   * Get a specific voice by ID
   */
  async getVoice(voiceId: string): Promise<Voice> {
    const response = await this.client.get<VoiceResponse>(`/voices/${voiceId}`);
    return response.voice;
  }

  // ============================================
  // Speech Generation Methods
  // ============================================

  /**
   * Generate speech from text
   */
  async generateSpeech(options: GenerateSpeechOptions): Promise<GenerateSpeechResponse> {
    return this.client.postRaw<GenerateSpeechResponse>('/audio/speech', {
      voice_id: options.voice_id,
      input: options.input,
      audio_format: options.audio_format || 'mp3',
      sample_rate: options.sample_rate,
      speed: options.speed,
      pitch: options.pitch,
    });
  }

  /**
   * Generate speech and return as Buffer
   */
  async speak(text: string, voiceId: string, options?: {
    audio_format?: 'mp3' | 'wav' | 'ogg' | 'aac';
    speed?: number;
    pitch?: number;
  }): Promise<{ audio: Buffer; contentType: string }> {
    const result = await this.generateSpeech({
      voice_id: voiceId,
      input: text,
      audio_format: options?.audio_format || 'mp3',
      speed: options?.speed,
      pitch: options?.pitch,
    });

    return {
      audio: Buffer.from(result.audio_data, 'base64'),
      contentType: (result as any).content_type || 'audio/mpeg',
    };
  }

  // ============================================
  // Voice Cloning Methods
  // ============================================

  /**
   * Clone a voice from audio sample
   */
  async cloneVoice(options: CloneVoiceOptions): Promise<CloneVoiceResponse> {
    return this.client.post<CloneVoiceResponse>('/voices/clone', {
      name: options.name,
      sample_url: options.sample_url,
      description: options.description,
    });
  }

  /**
   * Delete a cloned voice
   */
  async deleteVoice(voiceId: string): Promise<DeleteVoiceResponse> {
    return this.client.delete<DeleteVoiceResponse>(`/voices/${voiceId}`);
  }

  // ============================================
  // Usage Methods
  // ============================================

  /**
   * Get usage statistics
   */
  async getUsage(): Promise<UsageResponse> {
    return this.client.get<UsageResponse>('/usage');
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
  getClient(): SpeechifyClient {
    return this.client;
  }
}

export { SpeechifyClient } from './client';

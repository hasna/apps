import type {
  PlayHTConfig,
  VoicesListResponse,
  Voice,
  ClonedVoicesResponse,
  GenerateSpeechOptions,
  GenerateSpeechResponse,
  CloneVoiceOptions,
  InstantCloneOptions,
  CloneVoiceResponse,
  DeleteVoiceResponse,
} from '../types';
import { PlayHTClient } from './client';

/**
 * PlayHT API Client
 * Text-to-speech API with voice cloning support
 */
export class PlayHT {
  private readonly client: PlayHTClient;

  constructor(config: PlayHTConfig) {
    this.client = new PlayHTClient(config);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): PlayHT {
    const apiKey = process.env.PLAYHT_API_KEY;
    const userId = process.env.PLAYHT_USER_ID;

    if (!apiKey) {
      throw new Error('PLAYHT_API_KEY environment variable is required');
    }
    if (!userId) {
      throw new Error('PLAYHT_USER_ID environment variable is required');
    }
    return new PlayHT({ apiKey, userId });
  }

  // ============================================
  // Voice Methods
  // ============================================

  /**
   * List all stock voices
   */
  async listVoices(): Promise<Voice[]> {
    return this.client.get<Voice[]>('/voices');
  }

  /**
   * List cloned voices
   */
  async listClonedVoices(): Promise<ClonedVoicesResponse> {
    return this.client.get<ClonedVoicesResponse>('/cloned-voices');
  }

  /**
   * Get voice by ID
   */
  async getVoice(voiceId: string): Promise<Voice> {
    const voices = await this.listVoices();
    const voice = voices.find(v => v.id === voiceId);
    if (!voice) {
      throw new Error(`Voice not found: ${voiceId}`);
    }
    return voice;
  }

  // ============================================
  // Speech Generation Methods
  // ============================================

  /**
   * Generate speech from text
   */
  async generateSpeech(options: GenerateSpeechOptions): Promise<GenerateSpeechResponse> {
    return this.client.post<GenerateSpeechResponse>('/tts', {
      text: options.text,
      voice: options.voice,
      output_format: options.output_format || 'mp3',
      voice_engine: options.voice_engine || 'PlayHT2.0-turbo',
      quality: options.quality || 'medium',
      speed: options.speed,
      sample_rate: options.sample_rate,
      seed: options.seed,
      temperature: options.temperature,
    });
  }

  /**
   * Generate speech and return audio as Buffer
   */
  async speak(text: string, voice: string, options?: {
    output_format?: 'mp3' | 'wav' | 'ogg' | 'flac' | 'mulaw';
    voice_engine?: 'PlayHT2.0' | 'PlayHT2.0-turbo' | 'PlayHT1.0' | 'Standard';
    quality?: 'draft' | 'low' | 'medium' | 'high' | 'premium';
    speed?: number;
  }): Promise<{ audio: Buffer; contentType: string; url?: string }> {
    const result = await this.generateSpeech({
      text,
      voice,
      output_format: options?.output_format || 'mp3',
      voice_engine: options?.voice_engine || 'PlayHT2.0-turbo',
      quality: options?.quality || 'medium',
      speed: options?.speed,
    });

    // PlayHT returns a URL to download the audio
    if (result.url) {
      const response = await fetch(result.url);
      const buffer = await response.arrayBuffer();
      return {
        audio: Buffer.from(buffer),
        contentType: response.headers.get('content-type') || 'audio/mpeg',
        url: result.url,
      };
    }

    throw new Error('No audio URL in response');
  }

  // ============================================
  // Voice Cloning Methods
  // ============================================

  /**
   * Clone a voice (high quality, takes longer)
   */
  async cloneVoice(options: CloneVoiceOptions): Promise<CloneVoiceResponse> {
    return this.client.post<CloneVoiceResponse>('/cloned-voices', {
      voice_name: options.voice_name,
      sample_file_url: options.sample_file_url,
      mime_type: options.mime_type,
    });
  }

  /**
   * Instant voice clone (faster but lower quality)
   */
  async instantCloneVoice(options: InstantCloneOptions): Promise<CloneVoiceResponse> {
    return this.client.post<CloneVoiceResponse>('/cloned-voices/instant', {
      voice_name: options.voice_name,
      sample_file_url: options.sample_file_url,
    });
  }

  /**
   * Delete a cloned voice
   */
  async deleteClonedVoice(voiceId: string): Promise<DeleteVoiceResponse> {
    return this.client.delete<DeleteVoiceResponse>(`/cloned-voices/${voiceId}`);
  }

  /**
   * Get a preview of the API key
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the user ID
   */
  getUserId(): string {
    return this.client.getUserId();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): PlayHTClient {
    return this.client;
  }
}

export { PlayHTClient } from './client';

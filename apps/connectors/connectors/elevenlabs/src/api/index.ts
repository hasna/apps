import type { ElevenLabsConfig } from '../types';
import { ElevenLabsClient } from './client';
import { VoicesApi } from './voices';
import { TTSApi } from './tts';
import { STTApi } from './stt';
import { STSApi } from './sts';
import { ModelsApi } from './models';
import { HistoryApi } from './history';
import { UserApi } from './user';
import { SoundEffectsApi } from './sound-effects';

/**
 * Main ElevenLabs connector class
 */
export class ElevenLabs {
  private readonly client: ElevenLabsClient;

  // API modules
  public readonly voices: VoicesApi;
  public readonly tts: TTSApi;
  public readonly stt: STTApi;
  public readonly sts: STSApi;
  public readonly models: ModelsApi;
  public readonly history: HistoryApi;
  public readonly user: UserApi;
  public readonly soundEffects: SoundEffectsApi;

  constructor(config: ElevenLabsConfig) {
    this.client = new ElevenLabsClient(config);
    this.voices = new VoicesApi(this.client);
    this.tts = new TTSApi(this.client);
    this.stt = new STTApi(this.client);
    this.sts = new STSApi(this.client);
    this.models = new ModelsApi(this.client);
    this.history = new HistoryApi(this.client);
    this.user = new UserApi(this.client);
    this.soundEffects = new SoundEffectsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for ELEVENLABS_API_KEY or XI_API_KEY
   */
  static fromEnv(): ElevenLabs {
    const apiKey = process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;

    if (!apiKey) {
      throw new Error('ELEVENLABS_API_KEY or XI_API_KEY environment variable is required');
    }
    return new ElevenLabs({ apiKey });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): ElevenLabsClient {
    return this.client;
  }

  /**
   * Quick TTS - generate speech and return audio
   */
  async speak(
    text: string,
    voiceId: string,
    options?: Parameters<TTSApi['convert']>[2]
  ): Promise<ArrayBuffer> {
    return this.tts.convert(voiceId, text, options);
  }

  /**
   * Quick transcribe - transcribe audio and return text
   */
  async transcribe(
    audioFile: File | Blob,
    options?: Parameters<STTApi['transcribe']>[1]
  ): Promise<string> {
    const result = await this.stt.transcribe(audioFile, options);
    return result.text;
  }
}

// Export with alias for compatibility
export { ElevenLabs as Connector };

export { ElevenLabsClient } from './client';
export { VoicesApi } from './voices';
export { TTSApi } from './tts';
export { STTApi } from './stt';
export { STSApi } from './sts';
export { ModelsApi } from './models';
export { HistoryApi } from './history';
export { UserApi } from './user';
export { SoundEffectsApi } from './sound-effects';

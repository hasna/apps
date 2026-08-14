import type { MinimaxClient } from './client';
import type { TTSModel, TTSRequest, TTSResponse } from '../types';

export interface TTSOptions {
  model?: TTSModel;
  voiceId?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  emotion?: string;
  format?: 'mp3' | 'wav' | 'pcm' | 'flac';
  sampleRate?: number;
  languageBoost?: string;
}

export class TTSApi {
  constructor(private readonly client: MinimaxClient) {}

  async generate(text: string, options: TTSOptions = {}): Promise<TTSResponse> {
    const request: TTSRequest = {
      model: options.model || 'speech-02-hd',
      text,
    };

    if (options.voiceId || options.speed || options.volume || options.pitch || options.emotion) {
      request.voice_setting = {};
      if (options.voiceId) request.voice_setting.voice_id = options.voiceId;
      if (options.speed) request.voice_setting.speed = options.speed;
      if (options.volume) request.voice_setting.vol = options.volume;
      if (options.pitch) request.voice_setting.pitch = options.pitch;
      if (options.emotion) request.voice_setting.emotion = options.emotion;
    }

    if (options.format || options.sampleRate) {
      request.audio_setting = {};
      if (options.format) request.audio_setting.format = options.format;
      if (options.sampleRate) request.audio_setting.sample_rate = options.sampleRate;
    }

    if (options.languageBoost) {
      request.language_boost = options.languageBoost;
    }

    return this.client.post<TTSResponse>('/t2a_v2', request);
  }

  async generateToBuffer(text: string, options: TTSOptions = {}): Promise<Buffer> {
    const response = await this.generate(text, options);

    if (!response.data?.audio) {
      throw new Error('No audio data in TTS response');
    }

    return Buffer.from(response.data.audio, 'hex');
  }
}

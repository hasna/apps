import type { MinimaxConfig } from '../types';
import { MinimaxClient } from './client';
import { VideoApi } from './video';
import { MusicApi } from './music';
import { TTSApi } from './tts';
import { ImageApi } from './image';
import { SoundEffectsApi } from './sound-effects';

export class Minimax {
  private readonly client: MinimaxClient;

  public readonly video: VideoApi;
  public readonly music: MusicApi;
  public readonly tts: TTSApi;
  public readonly image: ImageApi;
  public readonly soundEffects: SoundEffectsApi;

  constructor(config: MinimaxConfig) {
    this.client = new MinimaxClient(config);
    this.video = new VideoApi(this.client);
    this.music = new MusicApi(this.client);
    this.tts = new TTSApi(this.client);
    this.image = new ImageApi(this.client);
    this.soundEffects = new SoundEffectsApi(this.client);
  }

  static fromEnv(): Minimax {
    const apiKey = process.env.MINIMAX_API_KEY;
    const groupId = process.env.MINIMAX_GROUP_ID;

    if (!apiKey) {
      throw new Error('MINIMAX_API_KEY environment variable is required');
    }
    return new Minimax({ apiKey, groupId });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): MinimaxClient {
    return this.client;
  }
}

export const Connector = Minimax;

export { MinimaxClient } from './client';
export { VideoApi } from './video';
export { MusicApi } from './music';
export { TTSApi } from './tts';
export { ImageApi } from './image';
export { SoundEffectsApi } from './sound-effects';

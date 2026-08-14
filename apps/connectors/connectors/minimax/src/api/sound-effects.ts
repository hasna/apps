import type { MinimaxClient } from './client';
import type {
  SoundEffectRequest,
  SoundEffectResponse,
  SoundEffectStatusResponse,
} from '../types';

export interface SoundEffectOptions {
  duration?: number;
}

export class SoundEffectsApi {
  constructor(private readonly client: MinimaxClient) {}

  async generate(prompt: string, options: SoundEffectOptions = {}): Promise<SoundEffectResponse> {
    const request: SoundEffectRequest = {
      model: 'sound-effects-01',
      prompt,
      duration: options.duration,
    };

    return this.client.post<SoundEffectResponse>('/sound_generation', request);
  }

  async getStatus(taskId: string): Promise<SoundEffectStatusResponse> {
    return this.client.get<SoundEffectStatusResponse>('/query/sound_generation', { task_id: taskId });
  }

  async download(audioUrl: string): Promise<Buffer> {
    return this.client.downloadFile(audioUrl);
  }

  async generateAndWait(
    prompt: string,
    options: SoundEffectOptions = {},
    pollIntervalMs = 3000,
    maxAttempts = 60
  ): Promise<{ audioUrl: string }> {
    const job = await this.generate(prompt, options);
    const taskId = job.task_id;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      const status = await this.getStatus(taskId);

      if (status.status === 'Success') {
        const audioUrl = status.extra_info?.audio_url || status.audio_file;
        if (!audioUrl) throw new Error('No audio URL in completed response');
        return { audioUrl };
      }

      if (status.status === 'Fail') {
        throw new Error(`Sound effect generation failed: ${status.base_resp?.status_msg || 'Unknown error'}`);
      }
    }

    throw new Error('Sound effect generation timed out');
  }
}

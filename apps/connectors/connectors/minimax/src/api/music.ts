import type { MinimaxClient } from './client';
import type {
  MusicModel,
  MusicGenerateRequest,
  MusicGenerateResponse,
  MusicStatusResponse,
} from '../types';

export interface MusicOptions {
  model?: MusicModel;
  lyrics?: string;
  referVoice?: string;
  referInstrumental?: string;
  genre?: string;
  mood?: string;
  tempo?: number;
  duration?: number;
}

export class MusicApi {
  constructor(private readonly client: MinimaxClient) {}

  async generate(prompt: string, options: MusicOptions = {}): Promise<MusicGenerateResponse> {
    const request: MusicGenerateRequest = {
      model: options.model || 'music-01',
      prompt,
    };

    if (options.lyrics) request.lyrics = options.lyrics;
    if (options.referVoice) request.refer_voice = options.referVoice;
    if (options.referInstrumental) request.refer_instrumental = options.referInstrumental;
    if (options.genre) request.genre = options.genre;
    if (options.mood) request.mood = options.mood;
    if (options.tempo) request.tempo = options.tempo;
    if (options.duration) request.duration = options.duration;

    return this.client.post<MusicGenerateResponse>('/music_generation', request);
  }

  async getStatus(taskId: string): Promise<MusicStatusResponse> {
    return this.client.get<MusicStatusResponse>('/query/music_generation', { task_id: taskId });
  }

  async download(audioUrl: string): Promise<Buffer> {
    return this.client.downloadFile(audioUrl);
  }

  async generateAndWait(
    prompt: string,
    options: MusicOptions = {},
    pollIntervalMs = 5000,
    maxAttempts = 120
  ): Promise<{ audioUrl: string; lyrics?: string; instrumentalUrl?: string }> {
    const job = await this.generate(prompt, options);
    const taskId = job.task_id;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      const status = await this.getStatus(taskId);

      if (status.status === 'Success') {
        const audioUrl = status.extra_info?.audio_url || status.audio_file;
        if (!audioUrl) throw new Error('No audio URL in completed response');
        return {
          audioUrl,
          lyrics: status.extra_info?.lyrics,
          instrumentalUrl: status.extra_info?.instrumental_url,
        };
      }

      if (status.status === 'Fail') {
        throw new Error(`Music generation failed: ${status.base_resp?.status_msg || 'Unknown error'}`);
      }
    }

    throw new Error('Music generation timed out');
  }
}

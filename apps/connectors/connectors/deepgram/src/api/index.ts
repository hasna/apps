import type {
  DeepgramConfig,
  TranscriptionOptions,
  TranscriptionResult,
  SpeakOptions,
  SpeakResponse,
  ProjectsResponse,
  BalanceResponse,
  UsageSummary,
} from '../types';
import { DeepgramClient } from './client';

export class Deepgram {
  private readonly client: DeepgramClient;

  constructor(config: DeepgramConfig) {
    this.client = new DeepgramClient(config);
  }

  async transcribeUrl(audioUrl: string, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    return this.client.transcribeUrl(audioUrl, options);
  }

  async transcribeBuffer(audioData: Buffer, options?: TranscriptionOptions, contentType?: string): Promise<TranscriptionResult> {
    return this.client.transcribeBuffer(audioData, options, contentType);
  }

  async speak(text: string, options?: SpeakOptions): Promise<SpeakResponse> {
    return this.client.speak(text, options);
  }

  async listProjects(): Promise<ProjectsResponse> {
    return this.client.listProjects();
  }

  async getBalance(projectId: string): Promise<BalanceResponse> {
    return this.client.getBalance(projectId);
  }

  async getUsage(projectId: string, start: string, end: string): Promise<UsageSummary> {
    return this.client.getUsage(projectId, start, end);
  }

  static fromEnv(): Deepgram {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY environment variable is required');
    }
    return new Deepgram({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { DeepgramClient } from './client';

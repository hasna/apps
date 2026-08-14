import type {
  AssemblyAIConfig,
  TranscriptRequest,
  Transcript,
  TranscriptListResponse,
  UploadResponse,
  LemurTaskRequest,
  LemurResponse,
  LemurSummaryRequest,
  LemurQuestionAnswerRequest,
  LemurQuestionAnswerResponse,
} from '../types';
import { AssemblyAIClient } from './client';

export class AssemblyAI {
  private readonly client: AssemblyAIClient;

  constructor(config: AssemblyAIConfig) {
    this.client = new AssemblyAIClient(config);
  }

  async createTranscript(params: TranscriptRequest): Promise<Transcript> {
    return this.client.createTranscript(params);
  }

  async getTranscript(transcriptId: string): Promise<Transcript> {
    return this.client.getTranscript(transcriptId);
  }

  async listTranscripts(limit?: number, status?: string, created_on?: string): Promise<TranscriptListResponse> {
    return this.client.listTranscripts(limit, status, created_on);
  }

  async deleteTranscript(transcriptId: string): Promise<Transcript> {
    return this.client.deleteTranscript(transcriptId);
  }

  async waitForTranscript(transcriptId: string, pollIntervalMs?: number): Promise<Transcript> {
    return this.client.waitForTranscript(transcriptId, pollIntervalMs);
  }

  async upload(audioData: Buffer | Uint8Array): Promise<UploadResponse> {
    return this.client.upload(audioData);
  }

  async lemurTask(params: LemurTaskRequest): Promise<LemurResponse> {
    return this.client.lemurTask(params);
  }

  async lemurSummary(params: LemurSummaryRequest): Promise<LemurResponse> {
    return this.client.lemurSummary(params);
  }

  async lemurQuestionAnswer(params: LemurQuestionAnswerRequest): Promise<LemurQuestionAnswerResponse> {
    return this.client.lemurQuestionAnswer(params);
  }

  static fromEnv(): AssemblyAI {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      throw new Error('ASSEMBLYAI_API_KEY environment variable is required');
    }
    return new AssemblyAI({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { AssemblyAIClient } from './client';

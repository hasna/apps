import type { SupadataClient } from './client';
import { pollUntilComplete } from './client';
import type {
  TranscriptOptions,
  TranscriptResult,
  TranscriptJobResult,
  JobIdResponse,
  PollOptions,
} from '../types';

export class TranscriptApi {
  constructor(private readonly client: SupadataClient) {}

  async get(options: TranscriptOptions): Promise<TranscriptResult | JobIdResponse> {
    return this.client.get<TranscriptResult | JobIdResponse>('/transcript', {
      url: options.url,
      lang: options.lang,
      text: options.text,
      chunkSize: options.chunkSize,
      mode: options.mode,
    });
  }

  async getJob(jobId: string): Promise<TranscriptJobResult> {
    return this.client.get<TranscriptJobResult>(`/transcript/${encodeURIComponent(jobId)}`);
  }

  async getAndWait(options: TranscriptOptions, pollOptions?: PollOptions): Promise<TranscriptResult | TranscriptJobResult> {
    const result = await this.get(options);
    if ('jobId' in result) {
      return pollUntilComplete(() => this.getJob(result.jobId), pollOptions);
    }
    return result;
  }
}

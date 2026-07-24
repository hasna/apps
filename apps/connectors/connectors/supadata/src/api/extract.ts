import type { SupadataClient } from './client';
import { pollUntilComplete } from './client';
import type { ExtractOptions, ExtractJobResult, JobIdResponse, PollOptions } from '../types';

export class ExtractApi {
  constructor(private readonly client: SupadataClient) {}

  async start(options: ExtractOptions): Promise<JobIdResponse> {
    return this.client.post<JobIdResponse>('/extract', {
      url: options.url,
      prompt: options.prompt,
      schema: options.schema,
    });
  }

  async getJob(jobId: string): Promise<ExtractJobResult> {
    return this.client.get<ExtractJobResult>(`/extract/${encodeURIComponent(jobId)}`);
  }

  async extractAndWait(options: ExtractOptions, pollOptions?: PollOptions): Promise<ExtractJobResult> {
    const { jobId } = await this.start(options);
    return pollUntilComplete(() => this.getJob(jobId), pollOptions);
  }
}

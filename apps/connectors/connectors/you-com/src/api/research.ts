import type { YouComClient } from './client';
import type { ResearchCreateOptions, ResearchResponse } from '../types';

export class ResearchApi {
  constructor(private readonly client: YouComClient) {}

  async create(options: ResearchCreateOptions): Promise<ResearchResponse> {
    const body: Record<string, unknown> = {
      input: options.input,
    };

    if (options.research_effort !== undefined) {
      body.research_effort = options.research_effort;
    }
    if (options.source_control !== undefined) {
      body.source_control = options.source_control;
    }
    if (options.output_schema !== undefined) {
      body.output_schema = options.output_schema;
    }

    return this.client.post<ResearchResponse>(
      '/v1/research',
      body,
      this.client.getResearchBaseUrl(),
    );
  }
}

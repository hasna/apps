import type { YouSearchClient } from './client';
import type { ResearchOptions, ResearchResponse } from '../types';

/**
 * Research API - Multi-step research via POST /v1/research
 */
export class ResearchApi {
  constructor(private readonly client: YouSearchClient) {}

  /**
   * Run a research query with multi-step reasoning and citations
   */
  async research(options: ResearchOptions): Promise<ResearchResponse> {
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

    return this.client.post<ResearchResponse>('/v1/research', body);
  }
}

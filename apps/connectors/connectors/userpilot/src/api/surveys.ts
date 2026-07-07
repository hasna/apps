import type { DateRangeOptions, ListFlowsOptions, PaginationOptions } from '../types';
import type { UserpilotClient } from './client';

export class SurveysApi {
  constructor(private readonly client: UserpilotClient) {}

  list(options: ListFlowsOptions = {}): Promise<unknown> {
    return this.client.get('/surveys', options);
  }

  get(id: string): Promise<unknown> {
    return this.client.get(`/surveys/${encodeURIComponent(id)}`);
  }

  responses(id: string, options: PaginationOptions & DateRangeOptions = {}): Promise<unknown> {
    return this.client.get(`/surveys/${encodeURIComponent(id)}/responses`, options);
  }
}

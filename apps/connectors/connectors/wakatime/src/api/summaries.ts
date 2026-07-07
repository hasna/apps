import type { WakatimeClient } from './client';
import type { SummariesOptions } from '../types';

export class SummariesApi {
  constructor(private readonly client: WakatimeClient) {}

  async get(options: SummariesOptions = {}): Promise<unknown> {
    return this.client.get(`${this.client.userPath(options.user)}/summaries`, {
      start: options.start,
      end: options.end,
      range: options.range,
      project: options.project,
      timezone: options.timezone,
    });
  }
}

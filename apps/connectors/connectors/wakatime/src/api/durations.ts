import type { WakatimeClient } from './client';
import type { DurationsOptions } from '../types';

export class DurationsApi {
  constructor(private readonly client: WakatimeClient) {}

  async get(options: DurationsOptions): Promise<unknown> {
    return this.client.get(`${this.client.userPath(options.user)}/durations`, {
      date: options.date,
      project: options.project,
      timezone: options.timezone,
    });
  }
}

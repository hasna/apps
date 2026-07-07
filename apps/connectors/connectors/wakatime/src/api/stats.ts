import type { WakatimeClient } from './client';
import type { StatsOptions } from '../types';

export class StatsApi {
  constructor(private readonly client: WakatimeClient) {}

  async get(options: StatsOptions = {}): Promise<unknown> {
    const range = options.range ?? 'last_7_days';
    return this.client.get(
      `${this.client.userPath(options.user)}/stats/${encodeURIComponent(range)}`,
      {
        project: options.project,
        timeout: options.timeout,
      },
    );
  }
}

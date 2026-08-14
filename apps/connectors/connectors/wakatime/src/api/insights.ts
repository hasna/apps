import type { WakatimeClient } from './client';
import type { InsightOptions } from '../types';

export class InsightsApi {
  constructor(private readonly client: WakatimeClient) {}

  async get(options: InsightOptions): Promise<unknown> {
    const user = this.client.userPath(options.user);
    return this.client.get(
      `${user}/insights/${encodeURIComponent(options.insightType)}/${encodeURIComponent(options.range)}`,
    );
  }
}

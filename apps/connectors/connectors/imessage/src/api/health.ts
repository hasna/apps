import type { ImessageClient } from './client';
import type { IMessageHealth } from '../types';

/**
 * Health API module - check bridge and iMessage service status
 */
export class HealthApi {
  constructor(private readonly client: ImessageClient) {}

  /**
   * Check bridge and iMessage health
   */
  async check(): Promise<IMessageHealth> {
    return this.client.get<IMessageHealth>('/health');
  }
}

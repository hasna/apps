import type { ConnectorClient } from './client';
import type { JobStatusResponse } from '../types';

export class JobsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Poll a job until completion or failure
   * @param pollingUrl - The location URL returned when creating a job
   * @param maxWait - Maximum wait time in ms (default: 5 minutes)
   * @param interval - Initial polling interval in ms (default: 1000)
   */
  async poll(pollingUrl: string, maxWait: number = 300000, interval: number = 1000): Promise<JobStatusResponse> {
    const startTime = Date.now();
    let currentInterval = interval;

    while (Date.now() - startTime < maxWait) {
      const response = await this.client.get<JobStatusResponse>(pollingUrl.replace(/^https?:\/\/[^/]+/, ''));

      if (response.status === 'done') {
        return response;
      }

      if (response.status === 'failed') {
        throw new Error(
          `Job failed: ${response.error?.code || 'unknown'} - ${response.error?.message || 'Unknown error'}`
        );
      }

      // Exponential backoff capped at 15 seconds
      await new Promise(resolve => setTimeout(resolve, currentInterval));
      currentInterval = Math.min(currentInterval * 1.5, 15000);
    }

    throw new Error(`Job timed out after ${maxWait}ms`);
  }

  /**
   * Get the status of a job without polling
   */
  async getStatus(pollingUrl: string): Promise<JobStatusResponse> {
    return this.client.get<JobStatusResponse>(pollingUrl.replace(/^https?:\/\/[^/]+/, ''));
  }
}

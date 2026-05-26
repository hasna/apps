import type { FirecrawlClient } from './client';
import type {
  CrawlRequest,
  CrawlStartResponse,
  CrawlStatusResponse,
  CrawlCancelResponse,
} from '../types';

/**
 * Crawl API - Crawl entire websites
 */
export class CrawlApi {
  constructor(private readonly client: FirecrawlClient) {}

  /**
   * Start a new crawl job
   * @param url - The starting URL to crawl
   * @param options - Crawl options
   * @returns The crawl job ID
   */
  async start(url: string, options?: Omit<CrawlRequest, 'url'>): Promise<CrawlStartResponse> {
    const body: CrawlRequest = {
      url,
      ...options,
    };

    return this.client.post<CrawlStartResponse>('/crawl', body);
  }

  /**
   * Get the status of a crawl job
   * @param jobId - The crawl job ID
   */
  async getStatus(jobId: string): Promise<CrawlStatusResponse> {
    return this.client.get<CrawlStatusResponse>(`/crawl/${jobId}`);
  }

  /**
   * Cancel a running crawl job
   * @param jobId - The crawl job ID
   */
  async cancel(jobId: string): Promise<CrawlCancelResponse> {
    return this.client.delete<CrawlCancelResponse>(`/crawl/${jobId}`);
  }

  /**
   * Wait for a crawl job to complete
   * @param jobId - The crawl job ID
   * @param pollInterval - Polling interval in milliseconds (default: 2000)
   * @param timeout - Maximum wait time in milliseconds (default: 300000 = 5 minutes)
   */
  async waitForCompletion(
    jobId: string,
    pollInterval = 2000,
    timeout = 300000
  ): Promise<CrawlStatusResponse> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const status = await this.getStatus(jobId);

      if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
        return status;
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Crawl job ${jobId} timed out after ${timeout}ms`);
  }

  /**
   * Start a crawl and wait for completion
   * @param url - The starting URL to crawl
   * @param options - Crawl options
   * @param pollInterval - Polling interval in milliseconds
   * @param timeout - Maximum wait time in milliseconds
   */
  async crawlAndWait(
    url: string,
    options?: Omit<CrawlRequest, 'url'>,
    pollInterval = 2000,
    timeout = 300000
  ): Promise<CrawlStatusResponse> {
    const startResponse = await this.start(url, options);

    if (!startResponse.success || !startResponse.id) {
      throw new Error(startResponse.error || 'Failed to start crawl job');
    }

    return this.waitForCompletion(startResponse.id, pollInterval, timeout);
  }
}

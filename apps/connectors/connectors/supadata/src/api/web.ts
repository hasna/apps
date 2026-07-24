import type { SupadataClient } from './client';
import { pollUntilComplete } from './client';
import type {
  ScrapeOptions,
  ScrapeResult,
  MapOptions,
  MapResult,
  CrawlStartOptions,
  JobIdResponse,
  CrawlJobResult,
  PollOptions,
} from '../types';

export class WebApi {
  constructor(private readonly client: SupadataClient) {}

  async scrape(options: ScrapeOptions): Promise<ScrapeResult> {
    return this.client.get<ScrapeResult>('/web/scrape', {
      url: options.url,
      noLinks: options.noLinks,
      lang: options.lang,
    });
  }

  async map(options: MapOptions): Promise<MapResult> {
    return this.client.get<MapResult>('/web/map', { url: options.url });
  }

  async startCrawl(options: CrawlStartOptions): Promise<JobIdResponse> {
    return this.client.post<JobIdResponse>('/web/crawl', {
      url: options.url,
      limit: options.limit,
    });
  }

  async getCrawl(jobId: string): Promise<CrawlJobResult> {
    return this.client.get<CrawlJobResult>(`/web/crawl/${encodeURIComponent(jobId)}`);
  }

  async crawlAndWait(options: CrawlStartOptions, pollOptions?: PollOptions): Promise<CrawlJobResult> {
    const { jobId } = await this.startCrawl(options);
    return pollUntilComplete(() => this.getCrawl(jobId), pollOptions);
  }
}

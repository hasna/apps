import type { YouComConfig } from '../types';
import { YouComClient } from './client';
import { SearchApi } from './search';
import { ResearchApi } from './research';

export class YouCom {
  private readonly client: YouComClient;

  public readonly search: SearchApi;
  public readonly research: ResearchApi;

  constructor(config: YouComConfig) {
    this.client = new YouComClient(config);
    this.search = new SearchApi(this.client);
    this.research = new ResearchApi(this.client);
  }

  static fromEnv(): YouCom {
    const apiKey = process.env.YDC_API_KEY;

    if (!apiKey) {
      throw new Error('YDC_API_KEY environment variable is required');
    }

    return new YouCom({
      apiKey,
      searchBaseUrl: process.env.YDC_SEARCH_BASE_URL,
      researchBaseUrl: process.env.YDC_RESEARCH_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): YouComClient {
    return this.client;
  }
}

export { YouComClient } from './client';
export { SearchApi } from './search';
export { ResearchApi } from './research';

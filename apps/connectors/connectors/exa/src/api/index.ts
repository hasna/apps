import type { ExaConfig } from '../types';
import { ExaClient } from './client';
import { SearchApi } from './search';
import { ContentsApi } from './contents';
import { SimilarApi } from './similar';
import { AnswerApi } from './answer';
import { ContextApi } from './context';
import { ResearchApi } from './research';
import { WebsetsApi } from './websets';
import { TeamApi } from './team';

/**
 * Exa AI Search API client
 * Provides access to all Exa API endpoints
 */
export class Exa {
  private readonly client: ExaClient;

  // API modules
  public readonly search: SearchApi;
  public readonly contents: ContentsApi;
  public readonly similar: SimilarApi;
  public readonly answer: AnswerApi;
  public readonly context: ContextApi;
  public readonly research: ResearchApi;
  public readonly websets: WebsetsApi;
  public readonly team: TeamApi;

  constructor(config: ExaConfig) {
    this.client = new ExaClient(config);
    this.search = new SearchApi(this.client);
    this.contents = new ContentsApi(this.client);
    this.similar = new SimilarApi(this.client);
    this.answer = new AnswerApi(this.client);
    this.context = new ContextApi(this.client);
    this.research = new ResearchApi(this.client);
    this.websets = new WebsetsApi(this.client);
    this.team = new TeamApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for EXA_API_KEY
   */
  static fromEnv(): Exa {
    const apiKey = process.env.EXA_API_KEY;

    if (!apiKey) {
      throw new Error('EXA_API_KEY environment variable is required');
    }
    return new Exa({ apiKey });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): ExaClient {
    return this.client;
  }
}

export { ExaClient } from './client';
export { SearchApi } from './search';
export { ContentsApi } from './contents';
export { SimilarApi } from './similar';
export { AnswerApi } from './answer';
export { ContextApi } from './context';
export { ResearchApi } from './research';
export { WebsetsApi } from './websets';
export { TeamApi } from './team';

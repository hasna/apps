import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { JobsApi } from './jobs';
import { CandidatesApi } from './candidates';
import { CommentsApi } from './comments';
import { OffersApi } from './offers';
import { MembersApi } from './members';
import { StagesApi } from './stages';
import { MetadataApi, EventsApi } from './events';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly jobs: JobsApi;
  public readonly candidates: CandidatesApi;
  public readonly comments: CommentsApi;
  public readonly offers: OffersApi;
  public readonly members: MembersApi;
  public readonly stages: StagesApi;
  public readonly metadata: MetadataApi;
  public readonly events: EventsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.jobs = new JobsApi(this.client);
    this.candidates = new CandidatesApi(this.client);
    this.comments = new CommentsApi(this.client);
    this.offers = new OffersApi(this.client);
    this.members = new MembersApi(this.client);
    this.stages = new StagesApi(this.client);
    this.metadata = new MetadataApi(this.client);
    this.events = new EventsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.WORKABLE_API_TOKEN;
    const subdomain = process.env.WORKABLE_SUBDOMAIN;

    if (!apiKey) {
      throw new Error('WORKABLE_API_TOKEN environment variable is required');
    }
    if (!subdomain) {
      throw new Error('WORKABLE_SUBDOMAIN environment variable is required');
    }

    return new Connector({ apiKey, subdomain });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { JobsApi } from './jobs';
export { CandidatesApi } from './candidates';
export { CommentsApi } from './comments';
export { OffersApi } from './offers';
export { MembersApi } from './members';
export { StagesApi } from './stages';
export { MetadataApi, EventsApi } from './events';

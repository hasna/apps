import type { TinesConfig } from '../types';
import { TinesClient } from './client';
import { StoriesApi } from './stories';
import { AgentsApi } from './agents';
import { EventsApi } from './events';
import { FoldersApi } from './folders';
import { TeamsApi } from './teams';
import { UsersApi } from './users';
import { TunnelsApi } from './tunnels';
import { CredentialsApi } from './credentials';
import { AnnotationsApi } from './annotations';
import { StoryRunsApi } from './story-runs';
import { WebhooksApi } from './webhooks';

/**
 * Main Tines connector — SOAR workflow automation API.
 */
export class Tines {
  private readonly client: TinesClient;

  public readonly stories: StoriesApi;
  public readonly agents: AgentsApi;
  public readonly events: EventsApi;
  public readonly folders: FoldersApi;
  public readonly teams: TeamsApi;
  public readonly users: UsersApi;
  public readonly tunnels: TunnelsApi;
  public readonly credentials: CredentialsApi;
  public readonly annotations: AnnotationsApi;
  public readonly storyRuns: StoryRunsApi;
  public readonly webhooks: WebhooksApi;

  constructor(config: TinesConfig) {
    this.client = new TinesClient(config);
    this.stories = new StoriesApi(this.client);
    this.agents = new AgentsApi(this.client);
    this.events = new EventsApi(this.client);
    this.folders = new FoldersApi(this.client);
    this.teams = new TeamsApi(this.client);
    this.users = new UsersApi(this.client);
    this.tunnels = new TunnelsApi(this.client);
    this.credentials = new CredentialsApi(this.client);
    this.annotations = new AnnotationsApi(this.client);
    this.storyRuns = new StoryRunsApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
  }

  static fromEnv(): Tines {
    const apiKey = process.env.TINES_API_KEY;
    const tenantUrl = process.env.TINES_TENANT_URL;

    if (!apiKey) {
      throw new Error('TINES_API_KEY environment variable is required');
    }
    if (!tenantUrl) {
      throw new Error('TINES_TENANT_URL environment variable is required');
    }

    return new Tines({ apiKey, tenantUrl });
  }

  getClient(): TinesClient {
    return this.client;
  }
}

export { TinesClient } from './client';
export { StoriesApi } from './stories';
export { AgentsApi } from './agents';
export { EventsApi } from './events';
export { FoldersApi } from './folders';
export { TeamsApi } from './teams';
export { UsersApi } from './users';
export { TunnelsApi } from './tunnels';
export { CredentialsApi } from './credentials';
export { AnnotationsApi } from './annotations';
export { StoryRunsApi } from './story-runs';
export { WebhooksApi } from './webhooks';

import type { UserpilotConfig } from '../types';
import { UserpilotClient } from './client';
import { UsersApi } from './users';
import { CompaniesApi } from './companies';
import { ExperiencesApi } from './experiences';
import { FlowsApi } from './flows';
import { ChecklistsApi } from './checklists';
import { ResourceCentersApi } from './resource-centers';
import { SurveysApi } from './surveys';
import { SegmentsApi } from './segments';
import { GoalsApi } from './goals';
import { EventsApi } from './events';
import { FeatureTagsApi } from './feature-tags';
import { AttributesApi } from './attributes';
import { WebhooksApi } from './webhooks';

export class Userpilot {
  private readonly client: UserpilotClient;

  public readonly users: UsersApi;
  public readonly companies: CompaniesApi;
  public readonly experiences: ExperiencesApi;
  public readonly flows: FlowsApi;
  public readonly checklists: ChecklistsApi;
  public readonly resourceCenters: ResourceCentersApi;
  public readonly surveys: SurveysApi;
  public readonly segments: SegmentsApi;
  public readonly goals: GoalsApi;
  public readonly events: EventsApi;
  public readonly featureTags: FeatureTagsApi;
  public readonly attributes: AttributesApi;
  public readonly webhooks: WebhooksApi;

  constructor(config: UserpilotConfig) {
    this.client = new UserpilotClient(config);
    this.users = new UsersApi(this.client);
    this.companies = new CompaniesApi(this.client);
    this.experiences = new ExperiencesApi(this.client);
    this.flows = new FlowsApi(this.client);
    this.checklists = new ChecklistsApi(this.client);
    this.resourceCenters = new ResourceCentersApi(this.client);
    this.surveys = new SurveysApi(this.client);
    this.segments = new SegmentsApi(this.client);
    this.goals = new GoalsApi(this.client);
    this.events = new EventsApi(this.client);
    this.featureTags = new FeatureTagsApi(this.client);
    this.attributes = new AttributesApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
  }

  static fromEnv(): Userpilot {
    const apiKey = process.env.USERPILOT_API_KEY;
    if (!apiKey) {
      throw new Error('USERPILOT_API_KEY environment variable is required');
    }
    return new Userpilot({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): UserpilotClient {
    return this.client;
  }
}

export { UserpilotClient } from './client';
export { UsersApi } from './users';
export { CompaniesApi } from './companies';
export { ExperiencesApi } from './experiences';
export { FlowsApi } from './flows';
export { ChecklistsApi } from './checklists';
export { ResourceCentersApi } from './resource-centers';
export { SurveysApi } from './surveys';
export { SegmentsApi } from './segments';
export { GoalsApi } from './goals';
export { EventsApi } from './events';
export { FeatureTagsApi } from './feature-tags';
export { AttributesApi } from './attributes';
export { WebhooksApi } from './webhooks';

import type { UserflowConfig } from '../types';
import { UserflowClient } from './client';
import { UsersApi } from './users';
import { GroupsApi } from './groups';
import { EventsApi } from './events';
import { FlowsApi } from './flows';
import {
  BannersApi,
  ChecklistsApi,
  LaunchersApi,
  ResourceCentersApi,
} from './content';
import { SurveysApi } from './surveys';
import { AttributesApi, SegmentsApi } from './metadata';
import { FeaturesApi } from './features';
import { MagicLinksApi } from './magic-links';
import { SignedDataKeysApi } from './signed-data-keys';
import { WebhooksApi } from './webhooks';

export class Userflow {
  private readonly client: UserflowClient;

  public readonly users: UsersApi;
  public readonly groups: GroupsApi;
  public readonly events: EventsApi;
  public readonly flows: FlowsApi;
  public readonly checklists: ChecklistsApi;
  public readonly resourceCenters: ResourceCentersApi;
  public readonly launchers: LaunchersApi;
  public readonly banners: BannersApi;
  public readonly surveys: SurveysApi;
  public readonly attributes: AttributesApi;
  public readonly segments: SegmentsApi;
  public readonly features: FeaturesApi;
  public readonly magicLinks: MagicLinksApi;
  public readonly signedDataKeys: SignedDataKeysApi;
  public readonly webhooks: WebhooksApi;

  constructor(config: UserflowConfig) {
    this.client = new UserflowClient(config);
    this.users = new UsersApi(this.client);
    this.groups = new GroupsApi(this.client);
    this.events = new EventsApi(this.client);
    this.flows = new FlowsApi(this.client);
    this.checklists = new ChecklistsApi(this.client);
    this.resourceCenters = new ResourceCentersApi(this.client);
    this.launchers = new LaunchersApi(this.client);
    this.banners = new BannersApi(this.client);
    this.surveys = new SurveysApi(this.client);
    this.attributes = new AttributesApi(this.client);
    this.segments = new SegmentsApi(this.client);
    this.features = new FeaturesApi(this.client);
    this.magicLinks = new MagicLinksApi(this.client);
    this.signedDataKeys = new SignedDataKeysApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
  }

  static fromEnv(): Userflow {
    const apiKey = process.env.USERFLOW_API_KEY;
    if (!apiKey?.trim()) {
      throw new Error('Userflow API key not configured.');
    }
    return new Userflow({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): UserflowClient {
    return this.client;
  }
}

export { UserflowClient } from './client';
export { UsersApi } from './users';
export { GroupsApi } from './groups';
export { EventsApi } from './events';
export { FlowsApi } from './flows';
export {
  BannersApi,
  ChecklistsApi,
  LaunchersApi,
  ResourceCentersApi,
} from './content';
export { SurveysApi } from './surveys';
export { AttributesApi, SegmentsApi } from './metadata';
export { FeaturesApi } from './features';
export { MagicLinksApi } from './magic-links';
export { SignedDataKeysApi } from './signed-data-keys';
export { WebhooksApi } from './webhooks';

import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { AccountApi } from './account';
import { CampaignsApi } from './campaigns';
import { GoalsApi } from './goals';
import { SegmentsApi } from './segments';
import { FeatureFlagsApi } from './feature-flags';
import { EnvironmentsApi } from './environments';
import { MetricsApi } from './metrics';
import { SurveysApi } from './surveys';
import { HeatmapsApi } from './heatmaps';
import { SessionRecordingsApi } from './session-recordings';
import { WebhooksApi } from './webhooks';
import { AuditLogApi } from './audit-log';
import { UsersApi } from './users';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly account: AccountApi;
  public readonly campaigns: CampaignsApi;
  public readonly goals: GoalsApi;
  public readonly segments: SegmentsApi;
  public readonly featureFlags: FeatureFlagsApi;
  public readonly environments: EnvironmentsApi;
  public readonly metrics: MetricsApi;
  public readonly surveys: SurveysApi;
  public readonly heatmaps: HeatmapsApi;
  public readonly sessionRecordings: SessionRecordingsApi;
  public readonly webhooks: WebhooksApi;
  public readonly auditLog: AuditLogApi;
  public readonly users: UsersApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.account = new AccountApi(this.client);
    this.campaigns = new CampaignsApi(this.client);
    this.goals = new GoalsApi(this.client);
    this.segments = new SegmentsApi(this.client);
    this.featureFlags = new FeatureFlagsApi(this.client);
    this.environments = new EnvironmentsApi(this.client);
    this.metrics = new MetricsApi(this.client);
    this.surveys = new SurveysApi(this.client);
    this.heatmaps = new HeatmapsApi(this.client);
    this.sessionRecordings = new SessionRecordingsApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
    this.auditLog = new AuditLogApi(this.client);
    this.users = new UsersApi(this.client);
  }

  static fromEnv(): Connector {
    const apiToken = process.env.VWO_API_TOKEN;
    const accountId = process.env.VWO_ACCOUNT_ID;

    if (!apiToken) {
      throw new Error('VWO_API_TOKEN environment variable is required');
    }
    if (!accountId) {
      throw new Error('VWO_ACCOUNT_ID environment variable is required');
    }

    return new Connector({ apiToken, accountId });
  }

  getApiTokenPreview(): string {
    return this.client.getApiTokenPreview();
  }

  getAccountId(): string {
    return this.client.getAccountId();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { AccountApi } from './account';
export { CampaignsApi } from './campaigns';
export { GoalsApi } from './goals';
export { SegmentsApi } from './segments';
export { FeatureFlagsApi } from './feature-flags';
export { EnvironmentsApi } from './environments';
export { MetricsApi } from './metrics';
export { SurveysApi } from './surveys';
export { HeatmapsApi } from './heatmaps';
export { SessionRecordingsApi } from './session-recordings';
export { WebhooksApi } from './webhooks';
export { AuditLogApi } from './audit-log';
export { UsersApi } from './users';

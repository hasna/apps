import type { MixpanelConfig } from '../types';
import { MixpanelClient } from './client';
import { TrackApi } from './track';
import { EngageApi } from './engage';
import { ExportApi } from './export';
import { InsightsApi } from './insights';
import { FunnelsApi } from './funnels';
import { RetentionApi } from './retention';

/**
 * Main Mixpanel Connector class
 * Provides access to Track, Engage, Export, Insights, Funnels, and Retention APIs
 */
export class Mixpanel {
  private readonly client: MixpanelClient;

  // Service APIs
  public readonly track: TrackApi;
  public readonly engage: EngageApi;
  public readonly export: ExportApi;
  public readonly insights: InsightsApi;
  public readonly funnels: FunnelsApi;
  public readonly retention: RetentionApi;

  constructor(config: MixpanelConfig) {
    this.client = new MixpanelClient(config);
    this.track = new TrackApi(this.client);
    this.engage = new EngageApi(this.client);
    this.export = new ExportApi(this.client);
    this.insights = new InsightsApi(this.client);
    this.funnels = new FunnelsApi(this.client);
    this.retention = new RetentionApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for MIXPANEL_PROJECT_TOKEN, MIXPANEL_API_SECRET, etc.
   */
  static fromEnv(): Mixpanel {
    const projectToken = process.env.MIXPANEL_PROJECT_TOKEN;
    const apiSecret = process.env.MIXPANEL_API_SECRET;
    const serviceAccountUsername = process.env.MIXPANEL_SERVICE_ACCOUNT_USERNAME;
    const serviceAccountSecret = process.env.MIXPANEL_SERVICE_ACCOUNT_SECRET;
    const projectId = process.env.MIXPANEL_PROJECT_ID;
    const envRegion = process.env.MIXPANEL_REGION?.toUpperCase();
    const region: 'US' | 'EU' | 'IN' = envRegion === 'EU' ? 'EU' : envRegion === 'IN' ? 'IN' : 'US';

    return new Mixpanel({
      projectToken,
      apiSecret,
      serviceAccountUsername,
      serviceAccountSecret,
      projectId,
      region,
    });
  }

  /**
   * Get a preview of the project token (for display/debugging)
   */
  getProjectTokenPreview(): string {
    const token = this.client.getProjectToken();
    if (token && token.length > 8) {
      return `${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
    }
    return token ? '***' : 'not set';
  }

  /**
   * Get current region
   */
  getRegion(): 'US' | 'EU' | 'IN' {
    return this.client.getRegion();
  }

  /**
   * Get project ID
   */
  getProjectId(): string | undefined {
    return this.client.getProjectId();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): MixpanelClient {
    return this.client;
  }
}

export { MixpanelClient } from './client';
export { TrackApi } from './track';
export { EngageApi } from './engage';
export { ExportApi } from './export';
export { InsightsApi } from './insights';
export { FunnelsApi } from './funnels';
export { RetentionApi } from './retention';

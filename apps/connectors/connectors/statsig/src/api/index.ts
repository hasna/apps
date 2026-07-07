import type { StatsigConfig } from '../types';
import { StatsigClient } from './client';
import { GatesApi } from './gates';
import { ExperimentsApi } from './experiments';
import { DynamicConfigsApi } from './dynamic-configs';
import { HoldoutsApi } from './holdouts';
import { SegmentsApi } from './segments';
import { LayersApi } from './layers';
import { AutotunesApi } from './autotunes';
import { MetricsApi } from './metrics';
import { TagsApi } from './tags';
import { UsersApi } from './users';
import { TeamsApi } from './teams';
import { EventsApi } from './events';

export class Statsig {
  private readonly client: StatsigClient;

  public readonly gates: GatesApi;
  public readonly experiments: ExperimentsApi;
  public readonly dynamicConfigs: DynamicConfigsApi;
  public readonly holdouts: HoldoutsApi;
  public readonly segments: SegmentsApi;
  public readonly layers: LayersApi;
  public readonly autotunes: AutotunesApi;
  public readonly metrics: MetricsApi;
  public readonly tags: TagsApi;
  public readonly users: UsersApi;
  public readonly teams: TeamsApi;
  public readonly events: EventsApi;

  constructor(config: StatsigConfig) {
    this.client = new StatsigClient(config);

    this.gates = new GatesApi(this.client);
    this.experiments = new ExperimentsApi(this.client);
    this.dynamicConfigs = new DynamicConfigsApi(this.client);
    this.holdouts = new HoldoutsApi(this.client);
    this.segments = new SegmentsApi(this.client);
    this.layers = new LayersApi(this.client);
    this.autotunes = new AutotunesApi(this.client);
    this.metrics = new MetricsApi(this.client);
    this.tags = new TagsApi(this.client);
    this.users = new UsersApi(this.client);
    this.teams = new TeamsApi(this.client);
    this.events = new EventsApi(this.client);
  }

  static fromEnv(): Statsig {
    const apiKey = process.env.STATSIG_API_KEY;
    const baseUrl = process.env.STATSIG_BASE_URL;

    if (!apiKey) {
      throw new Error('STATSIG_API_KEY environment variable is required');
    }

    return new Statsig({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { StatsigClient } from './client';
export { GatesApi } from './gates';
export { ExperimentsApi } from './experiments';
export { DynamicConfigsApi } from './dynamic-configs';
export { HoldoutsApi } from './holdouts';
export { SegmentsApi } from './segments';
export { LayersApi } from './layers';
export { AutotunesApi } from './autotunes';
export { MetricsApi } from './metrics';
export { TagsApi } from './tags';
export { UsersApi } from './users';
export { TeamsApi } from './teams';
export { EventsApi } from './events';

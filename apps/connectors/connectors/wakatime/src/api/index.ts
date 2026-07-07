import type { WakatimeConfig } from '../types';
import { WakatimeClient } from './client';
import { UsersApi } from './users';
import { HeartbeatsApi } from './heartbeats';
import { DurationsApi } from './durations';
import { SummariesApi } from './summaries';
import { StatsApi } from './stats';
import { InsightsApi } from './insights';
import { ProjectsApi } from './projects';
import { LeadersApi } from './leaders';
import { OrgsApi } from './orgs';
import { GoalsApi } from './goals';
import { CustomRulesApi } from './custom-rules';
import { EditorsApi } from './editors';
import { MetaApi } from './meta';

export { WakatimeClient } from './client';
export { UsersApi } from './users';
export { HeartbeatsApi } from './heartbeats';
export { DurationsApi } from './durations';
export { SummariesApi } from './summaries';
export { StatsApi } from './stats';
export { InsightsApi } from './insights';
export { ProjectsApi } from './projects';
export { LeadersApi } from './leaders';
export { OrgsApi } from './orgs';
export { GoalsApi } from './goals';
export { CustomRulesApi } from './custom-rules';
export { EditorsApi } from './editors';
export { MetaApi } from './meta';

export class Wakatime {
  private readonly client: WakatimeClient;

  public readonly users: UsersApi;
  public readonly heartbeats: HeartbeatsApi;
  public readonly durations: DurationsApi;
  public readonly summaries: SummariesApi;
  public readonly stats: StatsApi;
  public readonly insights: InsightsApi;
  public readonly projects: ProjectsApi;
  public readonly leaders: LeadersApi;
  public readonly orgs: OrgsApi;
  public readonly goals: GoalsApi;
  public readonly customRules: CustomRulesApi;
  public readonly editors: EditorsApi;
  public readonly meta: MetaApi;

  constructor(config: WakatimeConfig) {
    this.client = new WakatimeClient(config);
    this.users = new UsersApi(this.client);
    this.heartbeats = new HeartbeatsApi(this.client);
    this.durations = new DurationsApi(this.client);
    this.summaries = new SummariesApi(this.client);
    this.stats = new StatsApi(this.client);
    this.insights = new InsightsApi(this.client);
    this.projects = new ProjectsApi(this.client);
    this.leaders = new LeadersApi(this.client);
    this.orgs = new OrgsApi(this.client);
    this.goals = new GoalsApi(this.client);
    this.customRules = new CustomRulesApi(this.client);
    this.editors = new EditorsApi(this.client);
    this.meta = new MetaApi(this.client);
  }

  static fromEnv(): Wakatime {
    const apiKey = process.env.WAKATIME_API_KEY;
    if (!apiKey) {
      throw new Error('WAKATIME_API_KEY environment variable is required');
    }
    return new Wakatime({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): WakatimeClient {
    return this.client;
  }
}

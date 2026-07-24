import type { TesterArmyConfig, JsonBody, QueryParams } from '../types';
import { TesterArmyClient } from './client';
import { ProjectsApi } from './projects';
import { TestsApi } from './tests';
import { GroupsApi } from './groups';
import { RunsApi } from './runs';
import { WebhooksApi } from './webhooks';

export class TesterArmy {
  private readonly client: TesterArmyClient;
  public readonly projects: ProjectsApi;
  public readonly tests: TestsApi;
  public readonly groups: GroupsApi;
  public readonly runs: RunsApi;
  public readonly webhooks: WebhooksApi;

  constructor(config: TesterArmyConfig) {
    this.client = new TesterArmyClient(config);
    this.projects = new ProjectsApi(this.client);
    this.tests = new TestsApi(this.client);
    this.groups = new GroupsApi(this.client);
    this.runs = new RunsApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
  }

  static fromEnv(): TesterArmy {
    const apiKey = process.env.TESTERARMY_API_KEY;
    const baseUrl = process.env.TESTERARMY_BASE_URL;

    if (!apiKey) {
      throw new Error('TESTERARMY_API_KEY environment variable is required');
    }

    return new TesterArmy({ apiKey, baseUrl });
  }

  rawRequest(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      query?: QueryParams;
      body?: JsonBody;
      headers?: Record<string, string>;
    } = {},
  ): Promise<unknown> {
    return this.client.request(path, {
      method: options.method,
      params: options.query,
      body: options.body,
      headers: options.headers,
    });
  }

  getClient(): TesterArmyClient {
    return this.client;
  }
}

export { TesterArmyClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
export { ProjectsApi } from './projects';
export { TestsApi } from './tests';
export { GroupsApi } from './groups';
export { RunsApi } from './runs';
export { WebhooksApi } from './webhooks';

import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ProjectsApi } from './projects';
import { TasksApi } from './tasks';
import { TasklistsApi } from './tasklists';
import { MilestonesApi } from './milestones';
import { PeopleApi } from './people';
import { CompaniesApi } from './companies';
import { TimeApi } from './time';
import { CommentsApi } from './comments';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly projects: ProjectsApi;
  public readonly tasks: TasksApi;
  public readonly tasklists: TasklistsApi;
  public readonly milestones: MilestonesApi;
  public readonly people: PeopleApi;
  public readonly companies: CompaniesApi;
  public readonly time: TimeApi;
  public readonly comments: CommentsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.projects = new ProjectsApi(this.client);
    this.tasks = new TasksApi(this.client);
    this.tasklists = new TasklistsApi(this.client);
    this.milestones = new MilestonesApi(this.client);
    this.people = new PeopleApi(this.client);
    this.companies = new CompaniesApi(this.client);
    this.time = new TimeApi(this.client);
    this.comments = new CommentsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.TEAMWORK_API_KEY || process.env.TEAMWORK_API_TOKEN;
    const installation = process.env.TEAMWORK_INSTALLATION;
    const baseUrl = process.env.TEAMWORK_BASE_URL;

    if (!apiKey) {
      throw new Error('TEAMWORK_API_KEY environment variable is required');
    }
    if (!installation && !baseUrl) {
      throw new Error('TEAMWORK_INSTALLATION or TEAMWORK_BASE_URL environment variable is required');
    }
    return new Connector({ apiKey, installation, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { ProjectsApi } from './projects';
export { TasksApi } from './tasks';
export { TasklistsApi } from './tasklists';
export { MilestonesApi } from './milestones';
export { PeopleApi } from './people';
export { CompaniesApi } from './companies';
export { TimeApi } from './time';
export { CommentsApi } from './comments';
export { V3 } from './params';

import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { CompaniesApi } from './companies';
import { ContactsApi } from './contacts';
import { TasksApi } from './tasks';
import { IssuesApi } from './issues';
import { JobsApi } from './jobs';
import { ProspectsApi } from './prospects';
import { StaffApi } from './staff';
import { ActivitiesApi } from './activities';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly companies: CompaniesApi;
  public readonly contacts: ContactsApi;
  public readonly tasks: TasksApi;
  public readonly issues: IssuesApi;
  public readonly jobs: JobsApi;
  public readonly prospects: ProspectsApi;
  public readonly staff: StaffApi;
  public readonly activities: ActivitiesApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.companies = new CompaniesApi(this.client);
    this.contacts = new ContactsApi(this.client);
    this.tasks = new TasksApi(this.client);
    this.issues = new IssuesApi(this.client);
    this.jobs = new JobsApi(this.client);
    this.prospects = new ProspectsApi(this.client);
    this.staff = new StaffApi(this.client);
    this.activities = new ActivitiesApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.ACCELO_ACCESS_TOKEN;
    const deployment = process.env.ACCELO_DEPLOYMENT;

    if (!apiKey) {
      throw new Error('ACCELO_ACCESS_TOKEN environment variable is required');
    }
    return new Connector({ apiKey, deployment });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { CompaniesApi } from './companies';
export { ContactsApi } from './contacts';
export { TasksApi } from './tasks';
export { IssuesApi } from './issues';
export { JobsApi } from './jobs';
export { ProspectsApi } from './prospects';
export { StaffApi } from './staff';
export { ActivitiesApi } from './activities';

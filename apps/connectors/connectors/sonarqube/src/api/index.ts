import type { SonarQubeConfig } from '../types';
import { SonarQubeClient } from './client';
import { SystemApi } from './system';
import { ProjectsApi } from './projects';
import { IssuesApi } from './issues';
import { MeasuresApi } from './measures';
import { RulesApi } from './rules';
import { UsersApi } from './users';
import { GroupsApi } from './groups';
import { QualityGatesApi } from './qualitygates';
import { QualityProfilesApi } from './qualityprofiles';
import { WebhooksApi } from './webhooks';
import { CeApi } from './ce';

export class SonarQube {
  private readonly client: SonarQubeClient;

  public readonly system: SystemApi;
  public readonly projects: ProjectsApi;
  public readonly issues: IssuesApi;
  public readonly measures: MeasuresApi;
  public readonly rules: RulesApi;
  public readonly users: UsersApi;
  public readonly groups: GroupsApi;
  public readonly qualitygates: QualityGatesApi;
  public readonly qualityprofiles: QualityProfilesApi;
  public readonly webhooks: WebhooksApi;
  public readonly ce: CeApi;

  constructor(config: SonarQubeConfig) {
    this.client = new SonarQubeClient(config);
    this.system = new SystemApi(this.client);
    this.projects = new ProjectsApi(this.client);
    this.issues = new IssuesApi(this.client);
    this.measures = new MeasuresApi(this.client);
    this.rules = new RulesApi(this.client);
    this.users = new UsersApi(this.client);
    this.groups = new GroupsApi(this.client);
    this.qualitygates = new QualityGatesApi(this.client);
    this.qualityprofiles = new QualityProfilesApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
    this.ce = new CeApi(this.client);
  }

  static fromEnv(): SonarQube {
    const token = process.env.SONARQUBE_TOKEN;
    const baseUrl = process.env.SONARQUBE_BASE_URL;

    if (!token) {
      throw new Error('SONARQUBE_TOKEN environment variable is required');
    }
    if (!baseUrl) {
      throw new Error('SONARQUBE_BASE_URL environment variable is required');
    }

    return new SonarQube({ token, baseUrl });
  }

  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  getClient(): SonarQubeClient {
    return this.client;
  }
}

export { SonarQubeClient } from './client';
export { SystemApi } from './system';
export { ProjectsApi } from './projects';
export { IssuesApi } from './issues';
export { MeasuresApi } from './measures';
export { RulesApi } from './rules';
export { UsersApi } from './users';
export { GroupsApi } from './groups';
export { QualityGatesApi } from './qualitygates';
export { QualityProfilesApi } from './qualityprofiles';
export { WebhooksApi } from './webhooks';
export { CeApi } from './ce';

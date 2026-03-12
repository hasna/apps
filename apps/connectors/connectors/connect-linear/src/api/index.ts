import type { LinearConfig } from '../types';
import { LinearClient } from './client';
import { IssuesApi } from './issues';
import { ProjectsApi } from './projects';
import { TeamsApi } from './teams';
import { UsersApi } from './users';

export { LinearClient } from './client';
export { IssuesApi } from './issues';
export { ProjectsApi } from './projects';
export { TeamsApi } from './teams';
export { UsersApi } from './users';

/**
 * Main Linear API class
 */
export class Linear {
  private readonly client: LinearClient;

  public readonly issues: IssuesApi;
  public readonly projects: ProjectsApi;
  public readonly teams: TeamsApi;
  public readonly users: UsersApi;

  constructor(config: LinearConfig) {
    this.client = new LinearClient(config);
    this.issues = new IssuesApi(this.client);
    this.projects = new ProjectsApi(this.client);
    this.teams = new TeamsApi(this.client);
    this.users = new UsersApi(this.client);
  }

  /**
   * Test authentication and return current user
   */
  async test() {
    return this.users.me();
  }

  /**
   * Get the GraphQL client for custom queries
   */
  getClient(): LinearClient {
    return this.client;
  }
}

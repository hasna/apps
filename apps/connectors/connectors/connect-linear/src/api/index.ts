import type { LinearConfig } from '../types';
import { LinearClient } from './client';
import { IssuesApi } from './issues';
import { ProjectsApi } from './projects';
import { TeamsApi } from './teams';
import { UsersApi } from './users';
import { CommentsApi } from './comments';
import { StatesApi } from './states';

export { LinearClient } from './client';
export { IssuesApi } from './issues';
export { ProjectsApi } from './projects';
export { TeamsApi } from './teams';
export { UsersApi } from './users';
export { CommentsApi } from './comments';
export { StatesApi } from './states';

/**
 * Main Linear API class
 */
export class Linear {
  private readonly client: LinearClient;

  public readonly issues: IssuesApi;
  public readonly projects: ProjectsApi;
  public readonly teams: TeamsApi;
  public readonly users: UsersApi;
  public readonly comments: CommentsApi;
  public readonly states: StatesApi;

  constructor(config: LinearConfig) {
    this.client = new LinearClient(config);
    this.issues = new IssuesApi(this.client);
    this.projects = new ProjectsApi(this.client);
    this.teams = new TeamsApi(this.client);
    this.users = new UsersApi(this.client);
    this.comments = new CommentsApi(this.client);
    this.states = new StatesApi(this.client);
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

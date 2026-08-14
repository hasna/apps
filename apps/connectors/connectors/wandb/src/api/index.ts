import type { WandbConfig } from '../types';
import { WandbClient } from './client';
import { ViewerApi } from './viewer';
import { ProjectsApi } from './projects';
import { GraphqlApi } from './graphql';

export { WandbClient, DEFAULT_BASE_URL } from './client';
export { ViewerApi } from './viewer';
export { ProjectsApi } from './projects';
export { GraphqlApi } from './graphql';

/**
 * Main Weights & Biases GraphQL API class.
 */
export class Wandb {
  private readonly client: WandbClient;

  public readonly viewer: ViewerApi;
  public readonly projects: ProjectsApi;
  public readonly graphql: GraphqlApi;

  constructor(config: WandbConfig) {
    this.client = new WandbClient(config);
    this.viewer = new ViewerApi(this.client);
    this.projects = new ProjectsApi(this.client);
    this.graphql = new GraphqlApi(this.client);
  }

  async test() {
    return this.viewer.get();
  }

  getClient(): WandbClient {
    return this.client;
  }
}

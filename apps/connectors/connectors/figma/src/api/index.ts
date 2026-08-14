import type { FigmaConfig } from '../types';
import { FigmaClient } from './client';
import { FilesApi } from './files';
import { CommentsApi } from './comments';
import { TeamsApi } from './teams';
import { ProjectsApi } from './projects';
import { ComponentsApi } from './components';
import { StylesApi } from './styles';
import { WebhooksApi } from './webhooks';
import { UsersApi } from './users';
import { VariablesApi } from './variables';
import { DevResourcesApi } from './devresources';

/**
 * Main Figma Connector class
 * Provides access to all Figma API endpoints
 */
export class Figma {
  private readonly client: FigmaClient;

  // Service APIs
  public readonly files: FilesApi;
  public readonly comments: CommentsApi;
  public readonly teams: TeamsApi;
  public readonly projects: ProjectsApi;
  public readonly components: ComponentsApi;
  public readonly styles: StylesApi;
  public readonly webhooks: WebhooksApi;
  public readonly users: UsersApi;
  public readonly variables: VariablesApi;
  public readonly devResources: DevResourcesApi;

  constructor(config: FigmaConfig) {
    this.client = new FigmaClient(config);
    this.files = new FilesApi(this.client);
    this.comments = new CommentsApi(this.client);
    this.teams = new TeamsApi(this.client);
    this.projects = new ProjectsApi(this.client);
    this.components = new ComponentsApi(this.client);
    this.styles = new StylesApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
    this.users = new UsersApi(this.client);
    this.variables = new VariablesApi(this.client);
    this.devResources = new DevResourcesApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for FIGMA_ACCESS_TOKEN or FIGMA_TOKEN
   */
  static fromEnv(): Figma {
    const accessToken = process.env.FIGMA_ACCESS_TOKEN || process.env.FIGMA_TOKEN;

    if (!accessToken) {
      throw new Error('FIGMA_ACCESS_TOKEN or FIGMA_TOKEN environment variable is required');
    }

    return new Figma({ accessToken });
  }

  /**
   * Get a preview of the access token (for debugging)
   */
  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): FigmaClient {
    return this.client;
  }
}

export { FigmaClient } from './client';
export { FilesApi } from './files';
export { CommentsApi } from './comments';
export { TeamsApi } from './teams';
export { ProjectsApi } from './projects';
export { ComponentsApi } from './components';
export { StylesApi } from './styles';
export { WebhooksApi } from './webhooks';
export { UsersApi } from './users';
export { VariablesApi } from './variables';
export { DevResourcesApi } from './devresources';

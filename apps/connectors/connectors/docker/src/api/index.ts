import type { DockerConfig } from '../types';
import { DockerClient } from './client';
import { RepositoriesApi } from './example';

/**
 * Main Docker Hub API Client
 */
export class Docker {
  private readonly client: DockerClient;

  // API modules
  public readonly repositories: RepositoriesApi;

  constructor(config: DockerConfig) {
    this.client = new DockerClient(config);
    this.repositories = new RepositoriesApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for DOCKER_ACCESS_TOKEN or DOCKER_USERNAME/DOCKER_PASSWORD
   */
  static fromEnv(): Docker {
    const accessToken = process.env.DOCKER_ACCESS_TOKEN;
    const username = process.env.DOCKER_USERNAME;
    const password = process.env.DOCKER_PASSWORD;

    if (accessToken) {
      return new Docker({ accessToken });
    }

    if (!username || !password) {
      throw new Error('DOCKER_ACCESS_TOKEN or DOCKER_USERNAME/DOCKER_PASSWORD environment variables are required');
    }
    return new Docker({ username, password });
  }

  /**
   * Login and get JWT token
   */
  async login(): Promise<string> {
    return this.client.login();
  }

  /**
   * Get a preview of the credentials (for debugging)
   */
  getCredentialsPreview(): string {
    return this.client.getCredentialsPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): DockerClient {
    return this.client;
  }
}

// Export alias for backwards compatibility
export { Docker as Connector };
export { DockerClient, DockerClient as ConnectorClient } from './client';
export { RepositoriesApi, RepositoriesApi as ExampleApi } from './example';

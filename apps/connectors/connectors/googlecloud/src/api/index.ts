import type { GoogleCloudConfig } from '../types';
import { GoogleCloudClient } from './client';
import { ProjectsApi } from './projects';

/**
 * Main GoogleCloud class
 * Provides access to Google Cloud Resource Manager APIs
 */
export class GoogleCloud {
  private readonly client: GoogleCloudClient;

  // API modules
  public readonly projects: ProjectsApi;

  constructor(config: GoogleCloudConfig) {
    this.client = new GoogleCloudClient(config);
    this.projects = new ProjectsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for GOOGLE_CLOUD_API_KEY or GOOGLE_APPLICATION_CREDENTIALS
   */
  static fromEnv(): GoogleCloud {
    const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!apiKey && !credentialsPath) {
      throw new Error('GOOGLE_CLOUD_API_KEY or GOOGLE_APPLICATION_CREDENTIALS environment variable is required');
    }
    return new GoogleCloud({ apiKey, credentialsPath });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): GoogleCloudClient {
    return this.client;
  }
}

// For backward compatibility with scaffold pattern
export { GoogleCloud as Connector };

export { GoogleCloudClient, GoogleCloudClient as ConnectorClient } from './client';
export { ProjectsApi, ProjectsApi as ExampleApi } from './projects';

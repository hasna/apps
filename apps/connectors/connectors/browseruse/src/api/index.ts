import { BrowserUseClient, type BrowserUseClientConfig } from './client';
import { TasksApi } from './tasks';
import { SessionsApi } from './sessions';
import { ProfilesApi } from './profiles';
import { BrowsersApi } from './browsers';
import { SkillsApi, MarketplaceApi } from './skills';
import { FilesApi } from './files';
import { BillingApi } from './billing';

/**
 * Main Browser Use Connector class
 * Provides access to all Browser Use Cloud API endpoints
 */
export class BrowserUse {
  private readonly client: BrowserUseClient;

  // API modules
  public readonly tasks: TasksApi;
  public readonly sessions: SessionsApi;
  public readonly profiles: ProfilesApi;
  public readonly browsers: BrowsersApi;
  public readonly skills: SkillsApi;
  public readonly marketplace: MarketplaceApi;
  public readonly files: FilesApi;
  public readonly billing: BillingApi;

  constructor(config: BrowserUseClientConfig) {
    this.client = new BrowserUseClient(config);
    this.tasks = new TasksApi(this.client);
    this.sessions = new SessionsApi(this.client);
    this.profiles = new ProfilesApi(this.client);
    this.browsers = new BrowsersApi(this.client);
    this.skills = new SkillsApi(this.client);
    this.marketplace = new MarketplaceApi(this.client);
    this.files = new FilesApi(this.client);
    this.billing = new BillingApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for BROWSER_USE_API_KEY and optionally BROWSER_USE_BASE_URL
   */
  static fromEnv(): BrowserUse {
    const apiKey = process.env.BROWSER_USE_API_KEY;
    const baseUrl = process.env.BROWSER_USE_BASE_URL;

    if (!apiKey) {
      throw new Error('BROWSER_USE_API_KEY environment variable is required');
    }

    return new BrowserUse({ apiKey, baseUrl });
  }

  /**
   * Run a task with a simple interface
   */
  async run(task: string, options?: { schema?: Record<string, unknown>; timeout?: number }): Promise<unknown> {
    const result = await this.tasks.run(
      { task, schema: options?.schema },
      2000,
      options?.timeout || 300000
    );
    return result.output;
  }

  /**
   * Get API key preview (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get base URL
   */
  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): BrowserUseClient {
    return this.client;
  }
}

export { BrowserUseClient } from './client';
export { TasksApi } from './tasks';
export { SessionsApi } from './sessions';
export { ProfilesApi } from './profiles';
export { BrowsersApi } from './browsers';
export { SkillsApi, MarketplaceApi } from './skills';
export { FilesApi } from './files';
export { BillingApi } from './billing';

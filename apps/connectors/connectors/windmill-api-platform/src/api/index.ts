import type {
  WindmillApiPlatformConfig,
  QueryParams,
  RawRequestOptions,
  RunScriptOptions,
} from '../types';
import { WindmillApiPlatformClient } from './client';

export class WindmillApiPlatform {
  private readonly client: WindmillApiPlatformClient;

  constructor(config: WindmillApiPlatformConfig) {
    this.client = new WindmillApiPlatformClient(config);
  }

  async listScripts(query?: QueryParams): Promise<unknown> {
    return this.client.listScripts(query);
  }

  async getScript(path: string): Promise<unknown> {
    return this.client.getScript(path);
  }

  async runScript(options: RunScriptOptions): Promise<unknown> {
    return this.client.runScript(options);
  }

  async runScriptAndWait(options: RunScriptOptions): Promise<unknown> {
    return this.client.runScriptAndWait(options);
  }

  async listFlows(query?: QueryParams): Promise<unknown> {
    return this.client.listFlows(query);
  }

  async getFlow(path: string): Promise<unknown> {
    return this.client.getFlow(path);
  }

  async listResources(query?: QueryParams): Promise<unknown> {
    return this.client.listResources(query);
  }

  async getResource(path: string): Promise<unknown> {
    return this.client.getResource(path);
  }

  async listJobs(query?: QueryParams): Promise<unknown> {
    return this.client.listJobs(query);
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    return this.client.rawRequest(options);
  }

  static fromEnv(): WindmillApiPlatform {
    const apiKey = process.env.WINDMILL_API_PLATFORM_API_KEY;
    if (!apiKey) {
      throw new Error('WINDMILL_API_PLATFORM_API_KEY environment variable is required');
    }
    const baseUrl = process.env.WINDMILL_API_PLATFORM_BASE_URL;
    if (!baseUrl) {
      throw new Error('WINDMILL_API_PLATFORM_BASE_URL environment variable is required');
    }
    const workspace = process.env.WINDMILL_API_PLATFORM_WORKSPACE;
    if (!workspace) {
      throw new Error('WINDMILL_API_PLATFORM_WORKSPACE environment variable is required');
    }
    return new WindmillApiPlatform({
      apiKey,
      baseUrl,
      workspace,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { WindmillApiPlatformClient, DEFAULT_BASE_URL } from './client';

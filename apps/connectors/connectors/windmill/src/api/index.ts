import type {
  WindmillConfig,
  ScriptRecord,
  SearchRequest,
  RawRequestOptions,
} from '../types';
import { WindmillClient } from './client';

export class Windmill {
  private readonly client: WindmillClient;

  constructor(config: WindmillConfig) {
    this.client = new WindmillClient(config);
  }

  async listScripts(query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.listScripts(query);
  }

  async createScript(body: ScriptRecord): Promise<unknown> {
    return this.client.createScript(body);
  }

  async getScript(scriptId: string): Promise<unknown> {
    return this.client.getScript(scriptId);
  }

  async listEvents(query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.listEvents(query);
  }

  async search(body: SearchRequest): Promise<unknown> {
    return this.client.search(body);
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    return this.client.rawRequest(options);
  }

  static fromEnv(): Windmill {
    const apiKey = process.env.WINDMILL_API_KEY;
    if (!apiKey) {
      throw new Error('WINDMILL_API_KEY environment variable is required');
    }
    return new Windmill({
      apiKey,
      baseUrl: process.env.WINDMILL_BASE_URL,
      workspace: process.env.WINDMILL_WORKSPACE,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { WindmillClient, DEFAULT_BASE_URL } from './client';

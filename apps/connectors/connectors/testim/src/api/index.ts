import type { TestimConfig } from '../types';
import { TestimClient } from './client';
import { TestsApi } from './tests';

export class Testim {
  private readonly client: TestimClient;
  public readonly tests: TestsApi;

  constructor(config: TestimConfig) {
    this.client = new TestimClient(config);
    this.tests = new TestsApi(this.client);
  }

  static fromEnv(): Testim {
    const apiKey = process.env.TESTIM_API_KEY;
    const baseUrl = process.env.TESTIM_BASE_URL;

    if (!apiKey) {
      throw new Error('TESTIM_API_KEY environment variable is required');
    }

    return new Testim({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): TestimClient {
    return this.client;
  }
}

export { TestimClient } from './client';
export { TestsApi } from './tests';

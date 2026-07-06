import type { ShrinkResult, StoreService, TinypngConfig } from '../types';
import { SUPPORTED_STORE_SERVICES } from '../types';
import { TinypngClient } from './client';

export class Tinypng {
  private readonly client: TinypngClient;

  constructor(config: TinypngConfig) {
    this.client = new TinypngClient(config);
  }

  static fromEnv(): Tinypng {
    const apiKey = process.env.TINYPNG_API_KEY;
    if (!apiKey) {
      throw new Error('TINYPNG_API_KEY environment variable is required');
    }
    return new Tinypng({ apiKey });
  }

  async compressFromUrl(url: string): Promise<ShrinkResult> {
    return this.client.shrink({ source: { url } });
  }

  async compressAndPreserveCopyright(url: string): Promise<ShrinkResult> {
    return this.client.shrink({
      source: { url },
      preserve: ['copyright'],
    });
  }

  async compressWithStore(url: string, service: StoreService = 's3'): Promise<ShrinkResult> {
    if (!SUPPORTED_STORE_SERVICES.includes(service)) {
      throw new Error(`Unsupported store service "${service}". Supported: ${SUPPORTED_STORE_SERVICES.join(', ')}`);
    }
    return this.client.shrink({
      source: { url },
      store: { service },
    });
  }

  getClient(): TinypngClient {
    return this.client;
  }
}

export { TinypngClient } from './client';

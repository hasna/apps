import type { OutputDataResult, PreserveMetadata, ShrinkResult, ShrinkStoreOptions, TinypngConfig } from '../types';
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

  async compressAndPreserveCopyright(url: string): Promise<OutputDataResult> {
    return this.compressAndPreserve(url, ['copyright']);
  }

  async compressAndPreserve(url: string, preserve: PreserveMetadata[]): Promise<OutputDataResult> {
    const compressed = await this.compressFromUrl(url);
    return this.client.postOutputData(this.requireOutputUrl(compressed), { preserve });
  }

  async compressWithStore(url: string, store: ShrinkStoreOptions): Promise<ShrinkResult> {
    this.validateStoreOptions(store);
    const compressed = await this.compressFromUrl(url);
    return this.client.postOutput(this.requireOutputUrl(compressed), { store });
  }

  getClient(): TinypngClient {
    return this.client;
  }

  private requireOutputUrl(result: ShrinkResult): string {
    if (!result.location) {
      throw new Error('TinyPNG API did not return an output URL');
    }
    return result.location;
  }

  private validateStoreOptions(store: ShrinkStoreOptions): void {
    if (!SUPPORTED_STORE_SERVICES.includes(store.service)) {
      throw new Error(`Unsupported store service "${store.service}". Supported: ${SUPPORTED_STORE_SERVICES.join(', ')}`);
    }
    if (!store.path) {
      throw new Error('Store path is required');
    }
    if (store.service === 's3') {
      if (!store.aws_access_key_id || !store.aws_secret_access_key || !store.region) {
        throw new Error('S3 store requires aws_access_key_id, aws_secret_access_key, region, and path');
      }
    }
    if (store.service === 'gcs' && !store.gcp_access_token) {
      throw new Error('GCS store requires gcp_access_token and path');
    }
  }
}

export { TinypngClient } from './client';

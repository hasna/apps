import type { SupadataConfig } from '../types';
import { SupadataClient } from './client';
import { AccountApi } from './account';
import { WebApi } from './web';
import { TranscriptApi } from './transcript';
import { MetadataApi } from './metadata';
import { ExtractApi } from './extract';
import { YoutubeApi } from './youtube';

export class Supadata {
  private readonly client: SupadataClient;

  public readonly account: AccountApi;
  public readonly web: WebApi;
  public readonly transcript: TranscriptApi;
  public readonly metadata: MetadataApi;
  public readonly extract: ExtractApi;
  public readonly youtube: YoutubeApi;

  constructor(config: SupadataConfig) {
    this.client = new SupadataClient(config);
    this.account = new AccountApi(this.client);
    this.web = new WebApi(this.client);
    this.transcript = new TranscriptApi(this.client);
    this.metadata = new MetadataApi(this.client);
    this.extract = new ExtractApi(this.client);
    this.youtube = new YoutubeApi(this.client);
  }

  static fromEnv(): Supadata {
    const apiKey = process.env.SUPADATA_API_KEY;
    const baseUrl = process.env.SUPADATA_BASE_URL;

    if (!apiKey) {
      throw new Error('SUPADATA_API_KEY environment variable is required');
    }

    return new Supadata({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): SupadataClient {
    return this.client;
  }
}

export { SupadataClient, pollUntilComplete } from './client';
export { AccountApi } from './account';
export { WebApi } from './web';
export { TranscriptApi } from './transcript';
export { MetadataApi } from './metadata';
export { ExtractApi } from './extract';
export { YoutubeApi } from './youtube';

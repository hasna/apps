// DeepL Connector
// Translation, glossaries, and usage API

import { DeepLClient } from './client';
import { TranslateApi } from './translate';
import type { DeepLConfig } from '../types';

export { DeepLClient } from './client';
export { TranslateApi } from './translate';

export class DeepL {
  private readonly client: DeepLClient;
  public readonly translate: TranslateApi;

  constructor(config: DeepLConfig) {
    this.client = new DeepLClient(config);
    this.translate = new TranslateApi(this.client);
  }

  static fromEnv(): DeepL {
    const authKey = process.env.DEEPL_AUTH_KEY;
    if (!authKey) throw new Error('DEEPL_AUTH_KEY environment variable is required');
    return new DeepL({ authKey });
  }

  getClient(): DeepLClient {
    return this.client;
  }
}

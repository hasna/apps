import type { VivenuConfig } from '../types';
import { VivenuClient } from './client';
import { DistributionApi } from './distribution';

export class Vivenu {
  private readonly client: VivenuClient;
  readonly distribution: DistributionApi;

  constructor(config: VivenuConfig) {
    this.client = new VivenuClient(config);
    this.distribution = new DistributionApi(this.client);
  }

  static fromEnv(): Vivenu {
    const apiKey = process.env.VIVENU_API_KEY;
    const distributorType = process.env.VIVENU_DISTRIBUTOR_TYPE;
    if (!apiKey) {
      throw new Error('VIVENU_API_KEY environment variable is required');
    }
    if (!distributorType) {
      throw new Error('VIVENU_DISTRIBUTOR_TYPE environment variable is required');
    }
    return new Vivenu({
      apiKey,
      distributorType,
      baseUrl: process.env.VIVENU_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getDistributorType(): string {
    return this.client.getDistributorType();
  }

  getClient(): VivenuClient {
    return this.client;
  }
}

export { VivenuClient } from './client';
export { DistributionApi } from './distribution';

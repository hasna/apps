import type { SmileConfig } from '../types';
import { SmileClient } from './client';
import { CustomersApi } from './customers';
import { CustomerIdentitiesApi } from './customerIdentities';
import { PointsTransactionsApi } from './pointsTransactions';
import { PointsProductsApi } from './pointsProducts';
import { ActivitiesApi } from './activities';
import { EarningRulesApi } from './earningRules';
import { VipTiersApi } from './vipTiers';
import { PointsSettingsApi } from './pointsSettings';
import { RewardFulfillmentsApi } from './rewardFulfillments';

/**
 * Main Smile.io connector.
 * Wraps the REST API resource groups behind a single authenticated client.
 */
export class Smile {
  private readonly client: SmileClient;

  public readonly customers: CustomersApi;
  public readonly customerIdentities: CustomerIdentitiesApi;
  public readonly pointsTransactions: PointsTransactionsApi;
  public readonly pointsProducts: PointsProductsApi;
  public readonly activities: ActivitiesApi;
  public readonly earningRules: EarningRulesApi;
  public readonly vipTiers: VipTiersApi;
  public readonly pointsSettings: PointsSettingsApi;
  public readonly rewardFulfillments: RewardFulfillmentsApi;

  constructor(config: SmileConfig) {
    this.client = new SmileClient(config);
    this.customers = new CustomersApi(this.client);
    this.customerIdentities = new CustomerIdentitiesApi(this.client);
    this.pointsTransactions = new PointsTransactionsApi(this.client);
    this.pointsProducts = new PointsProductsApi(this.client);
    this.activities = new ActivitiesApi(this.client);
    this.earningRules = new EarningRulesApi(this.client);
    this.vipTiers = new VipTiersApi(this.client);
    this.pointsSettings = new PointsSettingsApi(this.client);
    this.rewardFulfillments = new RewardFulfillmentsApi(this.client);
  }

  /**
   * Build a Smile client from environment variables.
   * Reads SMILEIO_API_KEY (required) and SMILEIO_BASE_URL (optional).
   */
  static fromEnv(): Smile {
    const apiKey = process.env.SMILEIO_API_KEY;
    if (!apiKey) {
      throw new Error('SMILEIO_API_KEY environment variable is required');
    }
    return new Smile({ apiKey, baseUrl: process.env.SMILEIO_BASE_URL });
  }

  /** Access the underlying HTTP client for advanced/raw requests. */
  getClient(): SmileClient {
    return this.client;
  }
}

export { SmileClient } from './client';
export { CustomersApi } from './customers';
export { CustomerIdentitiesApi } from './customerIdentities';
export { PointsTransactionsApi } from './pointsTransactions';
export { PointsProductsApi } from './pointsProducts';
export { ActivitiesApi } from './activities';
export { EarningRulesApi } from './earningRules';
export { VipTiersApi } from './vipTiers';
export { PointsSettingsApi } from './pointsSettings';
export { RewardFulfillmentsApi } from './rewardFulfillments';

import type { WhopConfig } from '../types';
import { WhopClient } from './client';
import { MembershipsApi } from './memberships';
import { PlansApi } from './plans';
import { ProductsApi } from './products';
import { PaymentsApi } from './payments';
import { UsersApi } from './users';
import { WebhooksApi } from './webhooks';
import { PromoCodesApi } from './promo-codes';
import { ReviewsApi } from './reviews';
import { AffiliatesApi } from './affiliates';

export { WhopClient } from './client';
export { MembershipsApi } from './memberships';
export { PlansApi } from './plans';
export { ProductsApi } from './products';
export { PaymentsApi } from './payments';
export { UsersApi } from './users';
export { WebhooksApi } from './webhooks';
export { PromoCodesApi } from './promo-codes';
export { ReviewsApi } from './reviews';
export { AffiliatesApi } from './affiliates';

export class Whop {
  private readonly client: WhopClient;
  public readonly memberships: MembershipsApi;
  public readonly plans: PlansApi;
  public readonly products: ProductsApi;
  public readonly payments: PaymentsApi;
  public readonly users: UsersApi;
  public readonly webhooks: WebhooksApi;
  public readonly promoCodes: PromoCodesApi;
  public readonly reviews: ReviewsApi;
  public readonly affiliates: AffiliatesApi;

  constructor(config: WhopConfig) {
    this.client = new WhopClient(config);
    const scopeId = config.companyId;
    this.memberships = new MembershipsApi(this.client, scopeId);
    this.plans = new PlansApi(this.client, scopeId);
    this.products = new ProductsApi(this.client, scopeId);
    this.payments = new PaymentsApi(this.client, scopeId);
    this.users = new UsersApi(this.client);
    this.webhooks = new WebhooksApi(this.client, scopeId);
    this.promoCodes = new PromoCodesApi(this.client, scopeId);
    this.reviews = new ReviewsApi(this.client, scopeId);
    this.affiliates = new AffiliatesApi(this.client, scopeId);
  }

  static fromApiKey(apiKey: string, options?: Omit<WhopConfig, 'apiKey'>): Whop {
    return new Whop({ apiKey, ...options });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

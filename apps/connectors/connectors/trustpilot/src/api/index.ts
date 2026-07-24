import type { ConnectorConfig } from '../types';
import { TrustpilotClient } from './client';
import { CategoriesApi } from './categories';
import { BusinessUnitsApi } from './business-units';
import { ReviewsApi } from './reviews';
import { InvitationsApi } from './invitations';
import { ProductsApi } from './products';
import { ConsumersApi } from './consumers';
import { TagsApi } from './tags';
import { OAuthApi } from './oauth';

export class Connector {
  private readonly client: TrustpilotClient;

  public readonly categories: CategoriesApi;
  public readonly businessUnits: BusinessUnitsApi;
  public readonly reviews: ReviewsApi;
  public readonly invitations: InvitationsApi;
  public readonly products: ProductsApi;
  public readonly consumers: ConsumersApi;
  public readonly tags: TagsApi;
  public readonly oauth: OAuthApi;

  constructor(config: ConnectorConfig) {
    this.client = new TrustpilotClient(config);
    this.categories = new CategoriesApi(this.client);
    this.businessUnits = new BusinessUnitsApi(this.client);
    this.reviews = new ReviewsApi(this.client);
    this.invitations = new InvitationsApi(this.client);
    this.products = new ProductsApi(this.client);
    this.consumers = new ConsumersApi(this.client);
    this.tags = new TagsApi(this.client);
    this.oauth = OAuthApi.fromConfig(config);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.TRUSTPILOT_API_KEY;
    const accessToken = process.env.TRUSTPILOT_ACCESS_TOKEN;
    const baseUrl = process.env.TRUSTPILOT_BASE_URL;

    if (!apiKey && !accessToken) {
      throw new Error('TRUSTPILOT_API_KEY or TRUSTPILOT_ACCESS_TOKEN environment variable is required');
    }

    return new Connector({ apiKey, accessToken, baseUrl });
  }

  getClient(): TrustpilotClient {
    return this.client;
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { TrustpilotClient } from './client';
export { CategoriesApi } from './categories';
export { BusinessUnitsApi } from './business-units';
export { ReviewsApi } from './reviews';
export { InvitationsApi } from './invitations';
export { ProductsApi } from './products';
export { ConsumersApi } from './consumers';
export { TagsApi } from './tags';
export { OAuthApi } from './oauth';

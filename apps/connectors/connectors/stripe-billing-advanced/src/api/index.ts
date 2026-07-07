import { StripeBillingAdvancedClient } from './client';
import type {
  StripeBillingAdvancedConfig,
  StripeBillingObject,
  StripeBillingListResponse,
  ListParams,
} from '../types';

export { StripeBillingAdvancedClient, DEFAULT_API_VERSION, DEFAULT_BASE_URL, DEFAULT_BILLING_PATH_PREFIX } from './client';

function billingPath(client: StripeBillingAdvancedClient, suffix: string): string {
  const prefix = client.getBillingPathPrefix();
  const normalized = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `${prefix}${normalized}`;
}

function listParams(params?: ListParams): Record<string, string | number | boolean | undefined> | undefined {
  if (!params) return undefined;
  return {
    limit: params.limit,
    starting_after: params.starting_after,
    ending_before: params.ending_before,
  };
}

export class StripeBillingAdvanced {
  private readonly client: StripeBillingAdvancedClient;

  constructor(config: StripeBillingAdvancedConfig) {
    this.client = new StripeBillingAdvancedClient(config);
  }

  static fromEnv(): StripeBillingAdvanced {
    const apiKey = process.env.STRIPE_BILLING_ADVANCED_API_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_BILLING_ADVANCED_API_KEY environment variable is required');
    }
    return new StripeBillingAdvanced({
      apiKey,
      baseUrl: process.env.STRIPE_BILLING_ADVANCED_BASE_URL,
      apiVersion: process.env.STRIPE_BILLING_ADVANCED_API_VERSION,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): StripeBillingAdvancedClient {
    return this.client;
  }

  // Pricing plans
  listPricingPlans(params?: ListParams): Promise<StripeBillingListResponse> {
    return this.client.get(billingPath(this.client, '/pricing_plans'), listParams(params));
  }

  getPricingPlan(id: string): Promise<StripeBillingObject> {
    return this.client.get(billingPath(this.client, `/pricing_plans/${encodeURIComponent(id)}`));
  }

  createPricingPlan(body: Record<string, unknown>): Promise<StripeBillingObject> {
    return this.client.post(billingPath(this.client, '/pricing_plans'), body);
  }

  // Rate cards
  listRateCards(params?: ListParams): Promise<StripeBillingListResponse> {
    return this.client.get(billingPath(this.client, '/rate_cards'), listParams(params));
  }

  getRateCard(id: string): Promise<StripeBillingObject> {
    return this.client.get(billingPath(this.client, `/rate_cards/${encodeURIComponent(id)}`));
  }

  createRateCard(body: Record<string, unknown>): Promise<StripeBillingObject> {
    return this.client.post(billingPath(this.client, '/rate_cards'), body);
  }

  // Billing profiles
  getBillingProfile(id: string): Promise<StripeBillingObject> {
    return this.client.get(billingPath(this.client, `/profiles/${encodeURIComponent(id)}`));
  }

  createBillingProfile(body: Record<string, unknown>): Promise<StripeBillingObject> {
    return this.client.post(billingPath(this.client, '/profiles'), body);
  }

  // Cadences
  getCadence(id: string): Promise<StripeBillingObject> {
    return this.client.get(billingPath(this.client, `/cadences/${encodeURIComponent(id)}`));
  }

  createCadence(body: Record<string, unknown>): Promise<StripeBillingObject> {
    return this.client.post(billingPath(this.client, '/cadences'), body);
  }

  // Billing intents
  getIntent(id: string): Promise<StripeBillingObject> {
    return this.client.get(billingPath(this.client, `/intents/${encodeURIComponent(id)}`));
  }

  createIntent(body: Record<string, unknown>): Promise<StripeBillingObject> {
    return this.client.post(billingPath(this.client, '/intents'), body);
  }

  /**
   * Escape hatch for other /v2/billing paths not wrapped above.
   */
  rawRequest(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | string;
    } = {},
  ): Promise<unknown> {
    const normalized = path.startsWith('/v2/billing')
      ? path
      : billingPath(this.client, path.startsWith('/') ? path : `/${path}`);
    const { method = 'GET', params, body } = options;
    return this.client.request(normalized, { method, params, body });
  }
}

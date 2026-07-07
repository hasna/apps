export interface ZohoSubscriptionsConfig {
  token: string;
  organizationId: string;
  dataCenter?: string;
  baseUrl?: string;
}

export interface ZSCustomer {
  customer_id: string;
  display_name: string;
  email?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ZSSubscription {
  subscription_id: string;
  customer_id: string;
  plan?: { plan_code: string; name?: string };
  status?: string;
  [key: string]: unknown;
}

export interface ZSPlan {
  plan_code: string;
  name: string;
  recurring_price?: number;
  status?: string;
  [key: string]: unknown;
}

export interface ZSInvoice {
  invoice_id: string;
  invoice_number?: string;
  customer_id?: string;
  status?: string;
  total?: number;
  [key: string]: unknown;
}

export interface ZSWebhook {
  webhook_id: string;
  name: string;
  url: string;
  events?: string[];
  [key: string]: unknown;
}

export interface ZSOrganization {
  organization_id: string;
  name: string;
  [key: string]: unknown;
}

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export class ZohoSubscriptionsApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: number;

  constructor(message: string, statusCode: number, code?: number) {
    super(message);
    this.name = 'ZohoSubscriptionsApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

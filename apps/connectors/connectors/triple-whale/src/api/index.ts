import type { JsonRecord, PeriodOptions, QueryValue, TripleWhaleConfig } from "../types/index.js";
import {
  TripleWhaleClient,
  asRecord,
  bodyWithShop,
  compactRecord,
  dataBody,
  periodFromOptions,
  pickString,
  resolveShop,
} from "./client.js";

export class TripleWhale {
  private readonly client: TripleWhaleClient;

  constructor(config: TripleWhaleConfig) {
    this.client = new TripleWhaleClient(config);
  }

  static fromEnv(): TripleWhale {
    const apiKey = process.env.TRIPLE_WHALE_API_KEY;
    if (!apiKey) {
      throw new Error("TRIPLE_WHALE_API_KEY is required");
    }
    return new TripleWhale({
      apiKey,
      baseUrl: process.env.TRIPLE_WHALE_BASE_URL,
      shopDomain: process.env.TRIPLE_WHALE_SHOP_DOMAIN,
    });
  }

  getClient(): TripleWhaleClient {
    return this.client;
  }

  async validateApiKey(): Promise<unknown> {
    return this.client.request({ path: "/users/api-keys/me" });
  }

  async getSummary(
    options: JsonRecord & PeriodOptions & { todayHour?: number },
  ): Promise<unknown> {
    const period = periodFromOptions(options);
    const body = compactRecord({
      ...asRecord(options.body),
      shopDomain:
        pickString(options.shopDomain, options.shop, options.shopId) ??
        resolveShop(this.client, options),
      period,
      todayHour: options.todayHour ?? 25,
    });
    return this.client.request({
      path: "/summary-page/get-data",
      method: "POST",
      body,
    });
  }

  async pushMetrics(
    options: { metrics: Array<Record<string, unknown>> } & JsonRecord,
  ): Promise<unknown> {
    return this.client.request({
      path: "/tw-metrics/metrics",
      method: "POST",
      body: asRecord(options.body) ?? { metrics: options.metrics },
    });
  }

  async getMetricsData(
    options?: { shopDomain?: string; startDate?: string; endDate?: string } & JsonRecord,
  ): Promise<unknown> {
    return this.client.request({
      path: "/tw-metrics/metrics-data",
      query: {
        shop_domain: options?.shopDomain,
        start_date: options?.startDate,
        end_date: options?.endDate,
        ...asRecord(options?.query),
      },
    });
  }

  async exportAttributedOrders(
    options: JsonRecord &
      PeriodOptions & {
        startDate?: string;
        endDate?: string;
        page?: number;
        pageSize?: number;
        excludeJourneyData?: boolean;
      },
  ): Promise<unknown> {
    return this.client.request({
      path: "/attribution/get-orders-with-journeys-v2",
      method: "POST",
      body: compactRecord({
        ...asRecord(options.body),
        shop: pickString(options.shop) ?? resolveShop(this.client, options),
        startDate: pickString(options.startDate, options.start_date),
        endDate: pickString(options.endDate, options.end_date),
        page: options.page,
        pageSize: options.pageSize,
        excludeJourneyData: options.excludeJourneyData,
      }),
    });
  }

  async runSqlQuery(
    options: JsonRecord & PeriodOptions & { query: string; currency?: string },
  ): Promise<unknown> {
    return this.client.request({
      path: "/orcabase/api/sql",
      method: "POST",
      body: compactRecord({
        ...asRecord(options.body),
        shopId:
          pickString(options.shopId, options.shop, options.shopDomain) ??
          resolveShop(this.client, options),
        query: options.query,
        currency: options.currency,
        period: periodFromOptions(options),
      }),
    });
  }

  async askMoby(options: JsonRecord & { question: string }): Promise<unknown> {
    return this.client.request({
      path: "/orcabase/api/moby",
      method: "POST",
      body: compactRecord({
        ...asRecord(options.body),
        shopId:
          pickString(options.shopId, options.shop, options.shopDomain) ??
          resolveShop(this.client, options),
        question: options.question,
      }),
    });
  }

  private async postDataIn(
    path: string,
    options: JsonRecord,
    nestedKey?: string,
  ): Promise<unknown> {
    return this.client.request({
      path,
      method: "POST",
      body: bodyWithShop(this.client, options, nestedKey, "shop"),
    });
  }

  private async postPixelEvent(
    options: JsonRecord,
    forcedType?: string,
  ): Promise<unknown> {
    const event = bodyWithShop(this.client, options, "event", "shop");
    if (forcedType) event.type = forcedType;
    return this.client.request({
      path: "/data-in/event",
      method: "POST",
      body: event,
    });
  }

  async createOrderRecord(options: JsonRecord): Promise<unknown> {
    return this.postDataIn("/data-in/orders", options, "order");
  }

  async bulkCreateOrderRecords(
    options: JsonRecord & { orders?: JsonRecord[] },
  ): Promise<unknown> {
    const body = bodyWithShop(this.client, options, "batch", "shop");
    if (!body.orders && options.orders) body.orders = options.orders;
    return this.client.request({
      path: "/data-in/bulk-orders",
      method: "POST",
      body,
    });
  }

  async createCustomerRecord(options: JsonRecord): Promise<unknown> {
    return this.postDataIn("/data-in/customers", options, "customer");
  }

  async createProductRecord(options: JsonRecord): Promise<unknown> {
    return this.postDataIn("/data-in/products", options, "product");
  }

  async createSubscriptionRecord(options: JsonRecord): Promise<unknown> {
    return this.postDataIn("/data-in/subscriptions", options, "subscription");
  }

  async createPpsRecord(options: JsonRecord): Promise<unknown> {
    return this.postDataIn("/data-in/pps", options, "pps");
  }

  async createAdRecord(options: JsonRecord): Promise<unknown> {
    return this.postDataIn("/data-in/ads", options, "adRecord");
  }

  async enrichOrder(options: JsonRecord): Promise<unknown> {
    return this.postDataIn("/data-in/orders-enrichment", options, "order");
  }

  async enrichProduct(options: JsonRecord): Promise<unknown> {
    return this.postDataIn("/data-in/products-enrichment", options, "product");
  }

  async sendPixelOfflineEvent(options: JsonRecord): Promise<unknown> {
    return this.postPixelEvent(options);
  }

  async sendLeadEvent(options: JsonRecord): Promise<unknown> {
    return this.postPixelEvent(options, "lead");
  }

  async sendMqlEvent(options: JsonRecord): Promise<unknown> {
    return this.postPixelEvent(options, "mql");
  }

  async sendSqlEvent(options: JsonRecord): Promise<unknown> {
    return this.postPixelEvent(options, "sql");
  }

  async sendOpportunityEvent(options: JsonRecord): Promise<unknown> {
    return this.postPixelEvent(options, "opportunity");
  }

  async sendBookDemoEvent(options: JsonRecord): Promise<unknown> {
    return this.postPixelEvent(options, "book_demo");
  }

  async sendCustomEvent(options: JsonRecord): Promise<unknown> {
    return this.postPixelEvent(options, "custom");
  }

  async createComplianceDeletionRequest(options: JsonRecord): Promise<unknown> {
    return this.client.request({
      path: "/compliance/requests/create-request",
      method: "POST",
      body: bodyWithShop(this.client, options, "request", "shop"),
    });
  }

  async rawRequest(options: {
    path: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    query?: Record<string, QueryValue>;
    body?: JsonRecord | unknown[];
  }): Promise<unknown> {
    return this.client.request(options);
  }

  async request(options: {
    path: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    query?: Record<string, QueryValue>;
    body?: JsonRecord | unknown[];
  }): Promise<unknown> {
    return this.rawRequest(options);
  }
}

export { TripleWhaleClient, DEFAULT_BASE_URL, buildUrl, toApiPath, normalizeBaseUrl } from "./client.js";

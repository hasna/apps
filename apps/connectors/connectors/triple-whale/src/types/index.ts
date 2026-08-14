// Triple Whale Connector Types

export interface TripleWhaleConfig {
  apiKey: string;
  baseUrl?: string;
  shopDomain?: string;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type JsonRecord = Record<string, unknown>;
export type JsonBody = JsonRecord | unknown[];

export type QueryPrimitive = string | number | boolean;
export type QueryValue = QueryPrimitive | QueryPrimitive[] | JsonRecord | null | undefined;

export interface TripleWhaleRequestOptions {
  path: string;
  method?: HttpMethod;
  query?: Record<string, QueryValue>;
  body?: JsonBody;
  retries?: number;
  timeout?: number;
}

export interface PeriodOptions {
  period?: JsonRecord;
  startDate?: string;
  endDate?: string;
  start_date?: string;
  end_date?: string;
}

export type OutputFormat = "json" | "pretty";

export class TripleWhaleApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "TripleWhaleApiError";
    this.statusCode = statusCode;
  }
}

export interface ProfileConfig {
  apiKey?: string;
  shopDomain?: string;
  baseUrl?: string;
}

export const COMMAND_SPECS = [
  ["validateApiKey", "validate-api-key", "Validate the Triple Whale API key and return account metadata"],
  ["getSummary", "get-summary", "Get Summary Page data for a period"],
  ["pushMetrics", "push-metrics", "Push custom metrics into the Summary dashboard"],
  ["getMetricsData", "get-metrics-data", "Read custom metrics data"],
  ["exportAttributedOrders", "export-attributed-orders", "Export customer journey attribution data"],
  ["runSqlQuery", "run-sql-query", "Run a Triple Whale SQL data-out query"],
  ["askMoby", "ask-moby", "Ask Moby AI a natural-language analytics question"],
  ["createOrderRecord", "create-order-record", "Ingest one custom sales-platform order record"],
  ["bulkCreateOrderRecords", "bulk-create-order-records", "Ingest up to 1000 custom sales-platform order records"],
  ["createCustomerRecord", "create-customer-record", "Ingest one customer record"],
  ["createProductRecord", "create-product-record", "Ingest one product record"],
  ["createSubscriptionRecord", "create-subscription-record", "Ingest one subscription record"],
  ["createPpsRecord", "create-pps-record", "Ingest one post-purchase survey record"],
  ["createAdRecord", "create-ad-record", "Ingest one advertising performance record"],
  ["enrichOrder", "enrich-order", "Enrich an existing native integration order"],
  ["enrichProduct", "enrich-product", "Enrich an existing native integration product"],
  ["sendPixelOfflineEvent", "send-pixel-offline-event", "Send an offline or server-side Triple Pixel event"],
  ["sendLeadEvent", "send-lead-event", "Send a Triple Pixel lead event"],
  ["sendMqlEvent", "send-mql-event", "Send a Triple Pixel MQL event"],
  ["sendSqlEvent", "send-sql-event", "Send a Triple Pixel SQL event"],
  ["sendOpportunityEvent", "send-opportunity-event", "Send a Triple Pixel opportunity event"],
  ["sendBookDemoEvent", "send-book-demo-event", "Send a Triple Pixel book-demo event"],
  ["sendCustomEvent", "send-custom-event", "Send a Triple Pixel custom event"],
  ["createComplianceDeletionRequest", "create-compliance-deletion-request", "Create a customer PII deletion or masking request"],
  ["rawRequest", "raw-request", "Run an advanced relative Triple Whale API request"],
  ["request", "request", "Run an advanced relative Triple Whale API request"],
] as const;

export type TripleWhaleCommandMethod = (typeof COMMAND_SPECS)[number][0];

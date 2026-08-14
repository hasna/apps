import type { CloudflareConfig } from '../types';
import { CloudflareClient } from './client';
import { ZonesApi } from './zones';
import { DNSApi } from './dns';
import { WorkersApi } from './workers';
import { PagesApi } from './pages';
import { KVApi } from './kv';
import { R2Api } from './r2';
import { CacheApi } from './cache';
import { AnalyticsApi } from './analytics';
import { FirewallApi } from './firewall';
import { SSLApi } from './ssl';
import { AccountsApi } from './accounts';
import { BulkApi } from './bulk';
import {
  getApiToken,
  getApiKey,
  getEmail,
  getAccountId,
} from '../utils/config';

export class Cloudflare {
  private readonly client: CloudflareClient;

  // API modules
  public readonly zones: ZonesApi;
  public readonly dns: DNSApi;
  public readonly workers: WorkersApi;
  public readonly pages: PagesApi;
  public readonly kv: KVApi;
  public readonly r2: R2Api;
  public readonly cache: CacheApi;
  public readonly analytics: AnalyticsApi;
  public readonly firewall: FirewallApi;
  public readonly ssl: SSLApi;
  public readonly accounts: AccountsApi;
  public readonly bulk: BulkApi;

  constructor(config: CloudflareConfig) {
    this.client = new CloudflareClient(config);

    // Initialize API modules
    this.zones = new ZonesApi(this.client);
    this.dns = new DNSApi(this.client);
    this.workers = new WorkersApi(this.client);
    this.pages = new PagesApi(this.client);
    this.kv = new KVApi(this.client);
    this.r2 = new R2Api(this.client);
    this.cache = new CacheApi(this.client);
    this.analytics = new AnalyticsApi(this.client);
    this.firewall = new FirewallApi(this.client);
    this.ssl = new SSLApi(this.client);
    this.accounts = new AccountsApi(this.client);
    this.bulk = new BulkApi(this.client);
  }

  /**
   * Create a Cloudflare client from environment variables or config file
   * Priority: env vars > config file
   */
  static create(): Cloudflare {
    const apiToken = getApiToken();
    const apiKey = getApiKey();
    const email = getEmail();
    const accountId = getAccountId();

    if (!apiToken && !(apiKey && email)) {
      throw new Error(
        'Cloudflare credentials not configured. ' +
        'Set CLOUDFLARE_API_TOKEN or (CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL), ' +
        'or run "connect-cloudflare config set-token <token>"'
      );
    }

    return new Cloudflare({
      apiToken,
      apiKey,
      email,
      accountId,
    });
  }

  /**
   * Create a Cloudflare client from environment variables only
   */
  static fromEnv(): Cloudflare {
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const apiKey = process.env.CLOUDFLARE_API_KEY;
    const email = process.env.CLOUDFLARE_EMAIL;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!apiToken && !(apiKey && email)) {
      throw new Error(
        'CLOUDFLARE_API_TOKEN or (CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL) environment variables are required'
      );
    }

    return new Cloudflare({
      apiToken,
      apiKey,
      email,
      accountId,
    });
  }

  /**
   * Get a preview of the credentials (for debugging)
   */
  getCredentialPreview(): string {
    return this.client.getCredentialPreview();
  }

  /**
   * Get the configured account ID
   */
  getAccountId(): string | undefined {
    return this.client.getAccountId();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): CloudflareClient {
    return this.client;
  }
}

// Export the client and all API modules
export { CloudflareClient } from './client';
export { ZonesApi } from './zones';
export { DNSApi } from './dns';
export { WorkersApi } from './workers';
export { PagesApi } from './pages';
export { KVApi } from './kv';
export { R2Api } from './r2';
export { CacheApi } from './cache';
export { AnalyticsApi } from './analytics';
export { FirewallApi } from './firewall';
export { SSLApi } from './ssl';
export { AccountsApi } from './accounts';
export { BulkApi, FilterParser } from './bulk';
export type {
  DNSFilter,
  BulkOperationOptions,
  BulkProgress,
  BulkResult,
  BulkError,
  DNSImportRecord,
  DNSExportOptions,
} from './bulk';

import type { USPTOConfig } from '../types';
import { USPTOClient } from './client';
import { PatentsApi } from './patents';
import { TrademarksApi } from './trademarks';
import { PTABApi } from './ptab';
import { BrowserApi } from './browser';

/**
 * Main USPTO connector class
 */
export class USPTO {
  private readonly client: USPTOClient;
  private readonly config: USPTOConfig;

  // API modules
  public readonly patents: PatentsApi;
  public readonly trademarks: TrademarksApi;
  public readonly ptab: PTABApi;
  public readonly browser: BrowserApi;

  constructor(config: USPTOConfig = {}) {
    this.config = config;
    this.client = new USPTOClient(config);
    this.patents = new PatentsApi(this.client);
    this.trademarks = new TrademarksApi(this.client);
    this.ptab = new PTABApi(this.client);
    this.browser = new BrowserApi(config);
  }

  /**
   * Create a client from environment variables
   * Looks for USPTO_API_KEY or USPTO_TOKEN
   */
  static fromEnv(): USPTO {
    const apiKey = process.env.USPTO_API_KEY || process.env.USPTO_TOKEN;
    const headless = process.env.USPTO_HEADLESS !== 'false';
    const browser = process.env.USPTO_BROWSER as USPTOConfig['browser'];

    return new USPTO({ apiKey, headless, browser });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): USPTOClient {
    return this.client;
  }

  /**
   * Close browser resources
   */
  async close(): Promise<void> {
    await this.browser.close();
  }

  /**
   * Quick patent search
   */
  async searchPatents(query: string, rows = 25) {
    return this.patents.search({ query, rows });
  }

  /**
   * Quick trademark search
   */
  async searchTrademarks(query: string, rows = 25) {
    return this.trademarks.search({ query, rows });
  }

  /**
   * Check trademark availability (API + TESS)
   */
  async checkTrademarkAvailability(markText: string): Promise<{
    apiCheck: { available: boolean; conflicts: unknown[] };
    tessCheck?: { available: boolean; conflicts: unknown[] };
  }> {
    const apiCheck = await this.trademarks.checkAvailability(markText);

    let tessCheck;
    try {
      tessCheck = await this.browser.checkTrademarkAvailability(markText);
    } catch {
      // TESS may fail if browser not available
    }

    return {
      apiCheck,
      tessCheck,
    };
  }
}

export { USPTOClient } from './client';
export { PatentsApi } from './patents';
export { TrademarksApi } from './trademarks';
export { PTABApi } from './ptab';
export { BrowserApi } from './browser';

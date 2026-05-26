import type { WIPOConfig } from '../types';
import { WIPOClient } from './client';
import { PatentscopeApi } from './patentscope';
import { MadridApi } from './madrid';
import { PearlApi } from './pearl';
import { BrowserApi } from './browser';

/**
 * Main WIPO connector class
 */
export class WIPO {
  private readonly client: WIPOClient;
  private readonly config: WIPOConfig;

  // API modules
  public readonly patentscope: PatentscopeApi;
  public readonly madrid: MadridApi;
  public readonly pearl: PearlApi;
  public readonly browser: BrowserApi;

  constructor(config: WIPOConfig = {}) {
    this.config = config;
    this.client = new WIPOClient(config);
    this.patentscope = new PatentscopeApi(this.client);
    this.madrid = new MadridApi(this.client);
    this.pearl = new PearlApi(this.client);
    this.browser = new BrowserApi(config);
  }

  /**
   * Create a client from environment variables
   * Looks for WIPO_API_KEY or WIPO_TOKEN
   */
  static fromEnv(): WIPO {
    const apiKey = process.env.WIPO_API_KEY || process.env.WIPO_TOKEN;
    const headless = process.env.WIPO_HEADLESS !== 'false';
    const browser = process.env.WIPO_BROWSER as WIPOConfig['browser'];

    return new WIPO({ apiKey, headless, browser });
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
  getClient(): WIPOClient {
    return this.client;
  }

  /**
   * Close browser resources
   */
  async close(): Promise<void> {
    await this.browser.close();
  }

  /**
   * Quick PCT application search
   */
  async searchPCT(query: string, rows = 25) {
    return this.patentscope.search({ query, rows });
  }

  /**
   * Quick Madrid trademark search
   */
  async searchTrademarks(markName: string, rows = 25) {
    return this.madrid.search({ markName, rows });
  }

  /**
   * Quick terminology search
   */
  async searchTerms(term: string, sourceLanguage?: string, rows = 25) {
    return this.pearl.searchTerms({ term, sourceLanguage, rows });
  }

  /**
   * Check trademark availability (API + browser)
   */
  async checkTrademarkAvailability(markName: string, country?: string): Promise<{
    madridCheck: { available: boolean; conflicts: unknown[] };
    browserCheck?: { available: boolean; conflicts: unknown[] };
  }> {
    const madridCheck = await this.madrid.checkAvailability(markName, country);

    let browserCheck;
    try {
      browserCheck = await this.browser.checkTrademarkAvailability(markName);
    } catch {
      // Browser may fail if not available
    }

    return {
      madridCheck,
      browserCheck,
    };
  }

  /**
   * Translate a patent term
   */
  async translateTerm(term: string, sourceLanguage: string, targetLanguages: string[]) {
    return this.pearl.translate(term, sourceLanguage, targetLanguages);
  }
}

export { WIPOClient } from './client';
export { PatentscopeApi } from './patentscope';
export { MadridApi } from './madrid';
export { PearlApi } from './pearl';
export { BrowserApi } from './browser';

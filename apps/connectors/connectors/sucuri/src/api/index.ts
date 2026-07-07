// Sucuri Connector — documented website scanning API
import { SucuriClient } from './client';
import type { ScanRequestOptions } from './client';
import type { SucuriConfig, SucuriScanParams, SucuriScanResult } from '../types';

export { DEFAULT_SCAN_FORMAT, DEFAULT_TIMEOUT_MS, SucuriClient } from './client';
export type { ScanRequestOptions } from './client';

/**
 * High-level Sucuri Scanning API connector.
 */
export class Sucuri {
  private readonly client: SucuriClient;

  constructor(config: SucuriConfig) {
    this.client = new SucuriClient(config);
  }

  /**
   * Create a connector from environment variables.
   * Reads SUCURI_API_KEY and SUCURI_MONITOR_DOMAIN.
   */
  static fromEnv(): Sucuri {
    const apiKey = process.env.SUCURI_API_KEY;
    const monitorDomain = process.env.SUCURI_MONITOR_DOMAIN;
    if (!apiKey) {
      throw new Error('SUCURI_API_KEY environment variable is required');
    }
    if (!monitorDomain) {
      throw new Error('SUCURI_MONITOR_DOMAIN environment variable is required');
    }
    return new Sucuri({ apiKey, monitorDomain });
  }

  /** Request a real-time scan for a domain or URL. */
  async scan(params: SucuriScanParams, options?: ScanRequestOptions): Promise<SucuriScanResult> {
    return this.client.scan(params, options);
  }

  /** Get a non-secret API key status string. */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /** Get the underlying client for direct API access. */
  getClient(): SucuriClient {
    return this.client;
  }
}

export type { SucuriScanFormat, SucuriScanParams, SucuriScanResult } from '../types';

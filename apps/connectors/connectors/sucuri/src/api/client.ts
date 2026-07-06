import type { SucuriConfig, SucuriScanFormat, SucuriScanParams, SucuriScanResult } from '../types';
import { SucuriApiError } from '../types';

export const DEFAULT_SCAN_FORMAT: SucuriScanFormat = 'simple';
export const DEFAULT_TIMEOUT_MS = 180000;

export interface ScanRequestOptions {
  /** Request timeout in milliseconds. Scans can take a few minutes. */
  timeout?: number;
}

/**
 * Low-level client for Sucuri's documented Scanning API.
 *
 * Reference: https://docs.sucuri.net/website-monitoring/scanning-api/
 */
export class SucuriClient {
  private readonly apiKey: string;
  private readonly monitorDomain: string;

  constructor(config: SucuriConfig) {
    if (!config.apiKey) {
      throw new Error('Sucuri apiKey is required');
    }
    if (!config.monitorDomain) {
      throw new Error('Sucuri monitorDomain is required');
    }

    this.apiKey = config.apiKey;
    this.monitorDomain = normalizeMonitorDomain(config.monitorDomain);
  }

  /** Build the scan URL with the key, action, host, and output format parameters. */
  buildScanUrl(params: SucuriScanParams): string {
    if (!params.host) {
      throw new Error('Sucuri scan host is required');
    }

    const url = new URL('/scan-api.php', `${this.monitorDomain}/`);
    url.searchParams.set('k', this.apiKey);
    url.searchParams.set('a', 'scan');
    url.searchParams.set('host', params.host);
    url.searchParams.set('format', params.format || DEFAULT_SCAN_FORMAT);
    return url.toString();
  }

  /** Request a real-time scan for a site or URL. */
  async scan(params: SucuriScanParams, options: ScanRequestOptions = {}): Promise<SucuriScanResult> {
    const format = params.format || DEFAULT_SCAN_FORMAT;
    const response = await fetch(this.buildScanUrl({ ...params, format }), {
      method: 'GET',
      headers: {
        Accept: 'text/plain, */*',
      },
      signal: AbortSignal.timeout(options.timeout || DEFAULT_TIMEOUT_MS),
    });

    const body = await response.text();

    if (!response.ok) {
      throw new SucuriApiError(
        body || response.statusText || `Sucuri API error (${response.status})`,
        response.status,
        body,
      );
    }

    return {
      host: params.host,
      format,
      body,
    };
  }

  /** Get a non-secret status string for display/debugging. */
  getApiKeyPreview(): string {
    return 'configured';
  }

  /** Get the configured monitor domain URL. */
  getMonitorDomain(): string {
    return this.monitorDomain;
  }
}

function normalizeMonitorDomain(input: string): string {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withProtocol);
  return url.origin;
}

import type { ConnectorConfig } from '../types';
import { ConnectorApiError } from '../types';
import { checkApiError } from '../utils/xml';

// Namecheap API base URLs
const API_BASE = 'https://api.namecheap.com/xml.response';
const SANDBOX_BASE = 'https://api.sandbox.namecheap.com/xml.response';

/**
 * Low-level HTTP client for the Namecheap XML API.
 * Handles URL building, authentication params, and XML error checking.
 */
export class ConnectorClient {
  private readonly apiKey: string;
  private readonly username: string;
  private readonly clientIp: string;
  private readonly baseUrl: string;

  constructor(config: ConnectorConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    if (!config.username) {
      throw new Error('Username is required');
    }
    if (!config.clientIp) {
      throw new Error('Client IP is required');
    }
    this.apiKey = config.apiKey;
    this.username = config.username;
    this.clientIp = config.clientIp;
    this.baseUrl = config.sandbox ? SANDBOX_BASE : API_BASE;
  }

  /**
   * Build a full Namecheap API URL with auth params and command
   */
  buildUrl(command: string, extraParams?: Record<string, string>): string {
    const params = new URLSearchParams({
      ApiUser: this.username,
      ApiKey: this.apiKey,
      UserName: this.username,
      ClientIp: this.clientIp,
      Command: command,
      ...extraParams,
    });
    return `${this.baseUrl}?${params.toString()}`;
  }

  /**
   * Make an authenticated request to the Namecheap XML API
   * Returns raw XML string after error checking
   */
  async request(command: string, extraParams?: Record<string, string>): Promise<string> {
    const url = this.buildUrl(command, extraParams);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      headers: { 'User-Agent': 'connect-namecheap/0.1.0' },
    });

    if (!response.ok) {
      throw new ConnectorApiError(
        `Namecheap API HTTP error: ${response.status} ${response.statusText}`,
        response.status
      );
    }

    const xml = await response.text();
    checkApiError(xml);
    return xml;
  }

  /**
   * Get a preview of the API key (for display/debugging)
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}

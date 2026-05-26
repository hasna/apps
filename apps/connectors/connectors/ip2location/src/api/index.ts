// IP2Location Connector — IP geolocation and proxy detection
import { IP2LocationClient } from './client';
import type { IP2LocationConfig, IP2LocationResult, IP2ProxyResult } from '../types';
export { IP2LocationClient } from './client';

export class IP2Location {
  private readonly client: IP2LocationClient;
  constructor(config: IP2LocationConfig) { this.client = new IP2LocationClient(config); }
  static fromEnv(): IP2Location {
    const apiKey = process.env.IP2LOCATION_API_KEY;
    if (!apiKey) throw new Error('IP2LOCATION_API_KEY is required');
    return new IP2Location({ apiKey });
  }

  async lookup(ip: string, options?: { package?: string; lang?: string }): Promise<IP2LocationResult> {
    return this.client.request<IP2LocationResult>('/', { ip, package: options?.package, lang: options?.lang });
  }

  async proxyCheck(ip: string, options?: { package?: string }): Promise<IP2ProxyResult> {
    return this.client.request<IP2ProxyResult>('/proxycheck', { ip, package: options?.package });
  }

  async domainWhois(domain: string): Promise<Record<string, unknown>> {
    return this.client.request('/domain-whois', { domain });
  }

  getClient(): IP2LocationClient { return this.client; }
}

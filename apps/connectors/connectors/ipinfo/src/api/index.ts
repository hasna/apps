// IPinfo Connector — IP address data and geolocation API
import { IPinfoClient } from './client';
import type { IPinfoConfig, IPDetails, IPASNDetails, IPRanges } from '../types';
export { IPinfoClient } from './client';

export class IPinfo {
  private readonly client: IPinfoClient;
  constructor(config: IPinfoConfig) { this.client = new IPinfoClient(config); }
  static fromEnv(): IPinfo {
    const token = process.env.IPINFO_TOKEN;
    if (!token) throw new Error('IPINFO_TOKEN is required');
    return new IPinfo({ token });
  }

  async lookup(ip: string): Promise<IPDetails> { return this.client.request<IPDetails>(`/${ip}/json`); }
  async getMyIP(): Promise<IPDetails> { return this.client.request<IPDetails>('/json'); }
  async getField(ip: string, field: string): Promise<string> { return this.client.request<string>(`/${ip}/${field}`); }
  async getASN(asn: string): Promise<IPASNDetails> { return this.client.request<IPASNDetails>(`/${asn}/json`); }
  async getRanges(domain: string): Promise<IPRanges> { return this.client.request<IPRanges>(`/ranges/${domain}/json`); }
  async getCountry(ip: string): Promise<string> { return this.client.request<string>(`/${ip}/country`); }
  async getCity(ip: string): Promise<string> { return this.client.request<string>(`/${ip}/city`); }
  async getOrg(ip: string): Promise<string> { return this.client.request<string>(`/${ip}/org`); }

  getClient(): IPinfoClient { return this.client; }
}

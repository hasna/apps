import type { UpCloudClient } from './client';
import type { FirewallRule, IpAddress, Network } from '../types';

export class NetworkApi {
  constructor(private client: UpCloudClient) {}

  async listIpAddresses(): Promise<{ ip_addresses: { ip_address: IpAddress[] } }> {
    return this.client.get<{ ip_addresses: { ip_address: IpAddress[] } }>('/ip_address');
  }

  async getIpAddress(ip: string): Promise<{ ip_address: IpAddress }> {
    return this.client.get<{ ip_address: IpAddress }>(`/ip_address/${encodeURIComponent(ip)}`);
  }

  async assignIpAddress(params: {
    server: string;
    family: 'IPv4' | 'IPv6';
    access?: 'public' | 'private' | 'utility';
    floating?: 'yes' | 'no';
    mac?: string;
  }): Promise<{ ip_address: IpAddress }> {
    return this.client.post<{ ip_address: IpAddress }>('/ip_address', { ip_address: params });
  }

  async modifyIpAddress(ip: string, params: { ptr_record?: string; mac?: string }): Promise<{ ip_address: IpAddress }> {
    return this.client.put<{ ip_address: IpAddress }>(`/ip_address/${encodeURIComponent(ip)}`, { ip_address: params });
  }

  async releaseIpAddress(ip: string): Promise<void> {
    await this.client.delete(`/ip_address/${encodeURIComponent(ip)}`);
  }

  async listFirewallRules(serverUuid: string): Promise<{ firewall_rules: { firewall_rule: FirewallRule[] } }> {
    return this.client.get<{ firewall_rules: { firewall_rule: FirewallRule[] } }>(
      `/server/${encodeURIComponent(serverUuid)}/firewall_rule`,
    );
  }

  async createFirewallRule(serverUuid: string, rule: Record<string, unknown>): Promise<unknown> {
    return this.client.post(`/server/${encodeURIComponent(serverUuid)}/firewall_rule`, { firewall_rule: rule });
  }

  async deleteFirewallRule(serverUuid: string, position: number): Promise<void> {
    await this.client.delete(`/server/${encodeURIComponent(serverUuid)}/firewall_rule/${position}`);
  }

  async listNetworks(zone?: string): Promise<{ networks: { network: Network[] } }> {
    const path = zone ? `/network/${encodeURIComponent(zone)}` : '/network';
    return this.client.get<{ networks: { network: Network[] } }>(path);
  }

  async getNetwork(uuid: string): Promise<{ network: Network }> {
    return this.client.get<{ network: Network }>(`/network/${encodeURIComponent(uuid)}`);
  }

  async createNetwork(params: {
    name: string;
    zone: string;
    ip_networks: { ip_network: Array<Record<string, unknown>> };
    router?: string;
  }): Promise<{ network: Network }> {
    return this.client.post<{ network: Network }>('/network', { network: params });
  }

  async deleteNetwork(uuid: string): Promise<void> {
    await this.client.delete(`/network/${encodeURIComponent(uuid)}`);
  }
}

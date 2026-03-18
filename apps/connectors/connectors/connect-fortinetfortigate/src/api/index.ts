// Fortinet FortiGate Connector — Network security and firewall management
import { FortiGateClient } from './client';
import type { FortiGateConfig, FGFirewallPolicy, FGAddress, FGInterface, FGSystemStatus, FGVdom } from '../types';
export { FortiGateClient } from './client';

export class FortiGate {
  private readonly client: FortiGateClient;
  constructor(config: FortiGateConfig) { this.client = new FortiGateClient(config); }
  static fromEnv(): FortiGate {
    const url = process.env.FORTIGATE_URL;
    const token = process.env.FORTIGATE_TOKEN;
    if (!url || !token) throw new Error('FORTIGATE_URL and FORTIGATE_TOKEN are required');
    return new FortiGate({ url, token });
  }

  async getSystemStatus(): Promise<FGSystemStatus> { return this.client.request<FGSystemStatus>('/monitor/system/status'); }

  async listFirewallPolicies(options?: { vdom?: string }): Promise<FGFirewallPolicy[]> {
    return this.client.request<FGFirewallPolicy[]>('/cmdb/firewall/policy', { params: { vdom: options?.vdom || 'root' } });
  }
  async getFirewallPolicy(policyId: number, vdom?: string): Promise<FGFirewallPolicy> {
    return this.client.request<FGFirewallPolicy>(`/cmdb/firewall/policy/${policyId}`, { params: { vdom: vdom || 'root' } });
  }
  async createFirewallPolicy(data: { name: string; srcintf: { name: string }[]; dstintf: { name: string }[]; srcaddr: { name: string }[]; dstaddr: { name: string }[]; action: string; schedule: string; service: { name: string }[] }, vdom?: string): Promise<void> {
    await this.client.request('/cmdb/firewall/policy', { method: 'POST', body: data as Record<string, unknown>, params: { vdom: vdom || 'root' } });
  }

  async listAddresses(options?: { vdom?: string }): Promise<FGAddress[]> {
    return this.client.request<FGAddress[]>('/cmdb/firewall/address', { params: { vdom: options?.vdom || 'root' } });
  }

  async listInterfaces(): Promise<FGInterface[]> { return this.client.request<FGInterface[]>('/cmdb/system/interface'); }

  async listVdoms(): Promise<FGVdom[]> { return this.client.request<FGVdom[]>('/cmdb/system/vdom'); }

  async getRouteTable(vdom?: string): Promise<Record<string, unknown>[]> {
    return this.client.request('/monitor/router/ipv4', { params: { vdom: vdom || 'root' } });
  }

  getClient(): FortiGateClient { return this.client; }
}

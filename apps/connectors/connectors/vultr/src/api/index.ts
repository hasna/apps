import { VultrClient } from './client';
import type {
  VultrConfig,
  Account,
  Region,
  Plan,
  Instance,
  InstanceCreateParams,
  SSHKey,
  SSHKeyCreateParams,
  Snapshot,
  SnapshotCreateParams,
  Block,
  BlockCreateParams,
  FirewallGroup,
  FirewallGroupCreateParams,
  FirewallRule,
  FirewallRuleCreateParams,
  Meta,
  PaginatedParams,
} from '../types';

export { VultrClient };

type ListResponse<TKey extends string, TItem> = Record<TKey, TItem[]> & { meta: Meta };

/**
 * Vultr API v2 wrapper
 */
export class Vultr {
  private client: VultrClient;

  constructor(config: VultrConfig) {
    this.client = new VultrClient(config);
  }

  getClient(): VultrClient {
    return this.client;
  }

  // ============================================
  // Account
  // ============================================

  async getAccount(): Promise<{ account: Account }> {
    return this.client.get<{ account: Account }>('/account');
  }

  // ============================================
  // Regions
  // ============================================

  async listRegions(params?: PaginatedParams): Promise<ListResponse<'regions', Region>> {
    return this.client.get<ListResponse<'regions', Region>>('/regions', params);
  }

  // ============================================
  // Plans
  // ============================================

  async listPlans(params?: PaginatedParams & {
    type?: string;
    os?: string;
  }): Promise<ListResponse<'plans', Plan>> {
    return this.client.get<ListResponse<'plans', Plan>>('/plans', params);
  }

  // ============================================
  // Instances
  // ============================================

  async listInstances(params?: PaginatedParams & {
    label?: string;
    main_ip?: string;
    region?: string;
    firewall_group_id?: string;
    hostname?: string;
    show_pending_charges?: boolean;
  }): Promise<ListResponse<'instances', Instance>> {
    return this.client.get<ListResponse<'instances', Instance>>('/instances', params);
  }

  async getInstance(instanceId: string): Promise<{ instance: Instance }> {
    return this.client.get<{ instance: Instance }>(`/instances/${instanceId}`);
  }

  async createInstance(params: InstanceCreateParams): Promise<{ instance: Instance }> {
    return this.client.post<{ instance: Instance }>('/instances', params);
  }

  async deleteInstance(instanceId: string): Promise<void> {
    await this.client.delete(`/instances/${instanceId}`);
  }

  async rebootInstance(instanceId: string): Promise<void> {
    await this.client.post(`/instances/${instanceId}/reboot`);
  }

  async haltInstance(instanceId: string): Promise<void> {
    await this.client.post(`/instances/${instanceId}/halt`);
  }

  async startInstance(instanceId: string): Promise<void> {
    await this.client.post(`/instances/${instanceId}/start`);
  }

  // ============================================
  // SSH Keys
  // ============================================

  async listSSHKeys(params?: PaginatedParams): Promise<ListResponse<'ssh_keys', SSHKey>> {
    return this.client.get<ListResponse<'ssh_keys', SSHKey>>('/ssh-keys', params);
  }

  async getSSHKey(sshKeyId: string): Promise<{ ssh_key: SSHKey }> {
    return this.client.get<{ ssh_key: SSHKey }>(`/ssh-keys/${sshKeyId}`);
  }

  async createSSHKey(params: SSHKeyCreateParams): Promise<{ ssh_key: SSHKey }> {
    return this.client.post<{ ssh_key: SSHKey }>('/ssh-keys', params);
  }

  async deleteSSHKey(sshKeyId: string): Promise<void> {
    await this.client.delete(`/ssh-keys/${sshKeyId}`);
  }

  // ============================================
  // Snapshots
  // ============================================

  async listSnapshots(params?: PaginatedParams & {
    description?: string;
  }): Promise<ListResponse<'snapshots', Snapshot>> {
    return this.client.get<ListResponse<'snapshots', Snapshot>>('/snapshots', params);
  }

  async getSnapshot(snapshotId: string): Promise<{ snapshot: Snapshot }> {
    return this.client.get<{ snapshot: Snapshot }>(`/snapshots/${snapshotId}`);
  }

  async createSnapshot(params: SnapshotCreateParams): Promise<{ snapshot: Snapshot }> {
    return this.client.post<{ snapshot: Snapshot }>('/snapshots', params);
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    await this.client.delete(`/snapshots/${snapshotId}`);
  }

  // ============================================
  // Block Storage
  // ============================================

  async listBlocks(params?: PaginatedParams & {
    label?: string;
    region?: string;
  }): Promise<ListResponse<'blocks', Block>> {
    return this.client.get<ListResponse<'blocks', Block>>('/blocks', params);
  }

  async getBlock(blockId: string): Promise<{ block: Block }> {
    return this.client.get<{ block: Block }>(`/blocks/${blockId}`);
  }

  async createBlock(params: BlockCreateParams): Promise<{ block: Block }> {
    return this.client.post<{ block: Block }>('/blocks', params);
  }

  async deleteBlock(blockId: string): Promise<void> {
    await this.client.delete(`/blocks/${blockId}`);
  }

  async attachBlock(blockId: string, instanceId: string, live?: boolean): Promise<void> {
    await this.client.post(`/blocks/${blockId}/attach`, {
      instance_id: instanceId,
      live,
    });
  }

  async detachBlock(blockId: string, live?: boolean): Promise<void> {
    await this.client.post(`/blocks/${blockId}/detach`, { live });
  }

  // ============================================
  // Firewalls
  // ============================================

  async listFirewallGroups(params?: PaginatedParams): Promise<ListResponse<'firewall_groups', FirewallGroup>> {
    return this.client.get<ListResponse<'firewall_groups', FirewallGroup>>('/firewalls', params);
  }

  async getFirewallGroup(firewallGroupId: string): Promise<{ firewall_group: FirewallGroup }> {
    return this.client.get<{ firewall_group: FirewallGroup }>(`/firewalls/${firewallGroupId}`);
  }

  async createFirewallGroup(params?: FirewallGroupCreateParams): Promise<{ firewall_group: FirewallGroup }> {
    return this.client.post<{ firewall_group: FirewallGroup }>('/firewalls', params ?? {});
  }

  async deleteFirewallGroup(firewallGroupId: string): Promise<void> {
    await this.client.delete(`/firewalls/${firewallGroupId}`);
  }

  async listFirewallRules(firewallGroupId: string, params?: PaginatedParams): Promise<ListResponse<'firewall_rules', FirewallRule>> {
    return this.client.get<ListResponse<'firewall_rules', FirewallRule>>(`/firewalls/${firewallGroupId}/rules`, params);
  }

  async createFirewallRule(firewallGroupId: string, params: FirewallRuleCreateParams): Promise<{ firewall_rule: FirewallRule }> {
    return this.client.post<{ firewall_rule: FirewallRule }>(`/firewalls/${firewallGroupId}/rules`, params);
  }

  async deleteFirewallRule(firewallGroupId: string, ruleId: number): Promise<void> {
    await this.client.delete(`/firewalls/${firewallGroupId}/rules/${ruleId}`);
  }
}

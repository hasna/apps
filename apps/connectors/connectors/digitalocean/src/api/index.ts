import { DigitalOceanClient } from './client';
import type {
  DigitalOceanConfig,
  Account,
  Region,
  Size,
  Droplet,
  DropletCreateParams,
  Image,
  SSHKey,
  SSHKeyCreateParams,
  Volume,
  VolumeCreateParams,
  Domain,
  DomainRecord,
  DomainRecordCreateParams,
  Firewall,
  FirewallCreateParams,
  LoadBalancer,
  Database,
  DatabaseCreateParams,
  KubernetesCluster,
  Project,
  ProjectCreateParams,
  Snapshot,
  Action,
  FloatingIP,
  VPC,
  VPCCreateParams,
  Meta,
  Links,
} from '../types';

export { DigitalOceanClient };

/**
 * DigitalOcean API wrapper
 */
export class DigitalOcean {
  private client: DigitalOceanClient;

  constructor(config: DigitalOceanConfig) {
    this.client = new DigitalOceanClient(config);
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): DigitalOceanClient {
    return this.client;
  }

  // ============================================
  // Account Methods
  // ============================================

  /**
   * Get account information
   */
  async getAccount(): Promise<{ account: Account }> {
    return this.client.get<{ account: Account }>('/account');
  }

  // ============================================
  // Region Methods
  // ============================================

  /**
   * List all regions
   */
  async listRegions(): Promise<{ regions: Region[]; links: Links; meta: Meta }> {
    return this.client.get<{ regions: Region[]; links: Links; meta: Meta }>('/regions');
  }

  // ============================================
  // Size Methods
  // ============================================

  /**
   * List all sizes
   */
  async listSizes(): Promise<{ sizes: Size[]; links: Links; meta: Meta }> {
    return this.client.get<{ sizes: Size[]; links: Links; meta: Meta }>('/sizes');
  }

  // ============================================
  // Droplet Methods
  // ============================================

  /**
   * List droplets
   */
  async listDroplets(params?: {
    page?: number;
    per_page?: number;
    tag_name?: string;
  }): Promise<{ droplets: Droplet[]; links: Links; meta: Meta }> {
    return this.client.get<{ droplets: Droplet[]; links: Links; meta: Meta }>('/droplets', params);
  }

  /**
   * Get a droplet
   */
  async getDroplet(dropletId: number): Promise<{ droplet: Droplet }> {
    return this.client.get<{ droplet: Droplet }>(`/droplets/${dropletId}`);
  }

  /**
   * Create a droplet
   */
  async createDroplet(params: DropletCreateParams): Promise<{ droplet: Droplet }> {
    return this.client.post<{ droplet: Droplet }>('/droplets', params);
  }

  /**
   * Delete a droplet
   */
  async deleteDroplet(dropletId: number): Promise<void> {
    await this.client.delete(`/droplets/${dropletId}`);
  }

  /**
   * List droplet actions
   */
  async listDropletActions(dropletId: number, params?: {
    page?: number;
    per_page?: number;
  }): Promise<{ actions: Action[]; links: Links; meta: Meta }> {
    return this.client.get<{ actions: Action[]; links: Links; meta: Meta }>(`/droplets/${dropletId}/actions`, params);
  }

  /**
   * Perform a droplet action
   */
  async performDropletAction(dropletId: number, action: {
    type: 'reboot' | 'power_cycle' | 'shutdown' | 'power_off' | 'power_on' | 'restore' | 'password_reset' | 'resize' | 'rebuild' | 'rename' | 'change_kernel' | 'enable_ipv6' | 'enable_backups' | 'disable_backups' | 'snapshot';
    image?: string | number;
    disk?: boolean;
    size?: string;
    name?: string;
    kernel?: number;
  }): Promise<{ action: Action }> {
    return this.client.post<{ action: Action }>(`/droplets/${dropletId}/actions`, action);
  }

  // ============================================
  // Image Methods
  // ============================================

  /**
   * List images
   */
  async listImages(params?: {
    type?: 'distribution' | 'application' | 'backup' | 'snapshot';
    private?: boolean;
    page?: number;
    per_page?: number;
  }): Promise<{ images: Image[]; links: Links; meta: Meta }> {
    return this.client.get<{ images: Image[]; links: Links; meta: Meta }>('/images', params);
  }

  /**
   * Get an image
   */
  async getImage(imageId: number | string): Promise<{ image: Image }> {
    return this.client.get<{ image: Image }>(`/images/${imageId}`);
  }

  /**
   * Delete an image
   */
  async deleteImage(imageId: number): Promise<void> {
    await this.client.delete(`/images/${imageId}`);
  }

  // ============================================
  // SSH Key Methods
  // ============================================

  /**
   * List SSH keys
   */
  async listSSHKeys(params?: {
    page?: number;
    per_page?: number;
  }): Promise<{ ssh_keys: SSHKey[]; links: Links; meta: Meta }> {
    return this.client.get<{ ssh_keys: SSHKey[]; links: Links; meta: Meta }>('/account/keys', params);
  }

  /**
   * Get an SSH key
   */
  async getSSHKey(keyId: number | string): Promise<{ ssh_key: SSHKey }> {
    return this.client.get<{ ssh_key: SSHKey }>(`/account/keys/${keyId}`);
  }

  /**
   * Create an SSH key
   */
  async createSSHKey(params: SSHKeyCreateParams): Promise<{ ssh_key: SSHKey }> {
    return this.client.post<{ ssh_key: SSHKey }>('/account/keys', params);
  }

  /**
   * Delete an SSH key
   */
  async deleteSSHKey(keyId: number | string): Promise<void> {
    await this.client.delete(`/account/keys/${keyId}`);
  }

  // ============================================
  // Volume Methods
  // ============================================

  /**
   * List volumes
   */
  async listVolumes(params?: {
    name?: string;
    region?: string;
    page?: number;
    per_page?: number;
  }): Promise<{ volumes: Volume[]; links: Links; meta: Meta }> {
    return this.client.get<{ volumes: Volume[]; links: Links; meta: Meta }>('/volumes', params);
  }

  /**
   * Get a volume
   */
  async getVolume(volumeId: string): Promise<{ volume: Volume }> {
    return this.client.get<{ volume: Volume }>(`/volumes/${volumeId}`);
  }

  /**
   * Create a volume
   */
  async createVolume(params: VolumeCreateParams): Promise<{ volume: Volume }> {
    return this.client.post<{ volume: Volume }>('/volumes', params);
  }

  /**
   * Delete a volume
   */
  async deleteVolume(volumeId: string): Promise<void> {
    await this.client.delete(`/volumes/${volumeId}`);
  }

  /**
   * Attach a volume to a droplet
   */
  async attachVolume(volumeId: string, dropletId: number, region?: string): Promise<{ action: Action }> {
    return this.client.post<{ action: Action }>(`/volumes/${volumeId}/actions`, {
      type: 'attach',
      droplet_id: dropletId,
      region,
    });
  }

  /**
   * Detach a volume from a droplet
   */
  async detachVolume(volumeId: string, dropletId: number, region?: string): Promise<{ action: Action }> {
    return this.client.post<{ action: Action }>(`/volumes/${volumeId}/actions`, {
      type: 'detach',
      droplet_id: dropletId,
      region,
    });
  }

  // ============================================
  // Domain Methods
  // ============================================

  /**
   * List domains
   */
  async listDomains(params?: {
    page?: number;
    per_page?: number;
  }): Promise<{ domains: Domain[]; links: Links; meta: Meta }> {
    return this.client.get<{ domains: Domain[]; links: Links; meta: Meta }>('/domains', params);
  }

  /**
   * Get a domain
   */
  async getDomain(domainName: string): Promise<{ domain: Domain }> {
    return this.client.get<{ domain: Domain }>(`/domains/${domainName}`);
  }

  /**
   * Create a domain
   */
  async createDomain(name: string, ipAddress?: string): Promise<{ domain: Domain }> {
    return this.client.post<{ domain: Domain }>('/domains', { name, ip_address: ipAddress });
  }

  /**
   * Delete a domain
   */
  async deleteDomain(domainName: string): Promise<void> {
    await this.client.delete(`/domains/${domainName}`);
  }

  /**
   * List domain records
   */
  async listDomainRecords(domainName: string, params?: {
    name?: string;
    type?: string;
    page?: number;
    per_page?: number;
  }): Promise<{ domain_records: DomainRecord[]; links: Links; meta: Meta }> {
    return this.client.get<{ domain_records: DomainRecord[]; links: Links; meta: Meta }>(`/domains/${domainName}/records`, params);
  }

  /**
   * Get a domain record
   */
  async getDomainRecord(domainName: string, recordId: number): Promise<{ domain_record: DomainRecord }> {
    return this.client.get<{ domain_record: DomainRecord }>(`/domains/${domainName}/records/${recordId}`);
  }

  /**
   * Create a domain record
   */
  async createDomainRecord(domainName: string, params: DomainRecordCreateParams): Promise<{ domain_record: DomainRecord }> {
    return this.client.post<{ domain_record: DomainRecord }>(`/domains/${domainName}/records`, params);
  }

  /**
   * Update a domain record
   */
  async updateDomainRecord(domainName: string, recordId: number, params: Partial<DomainRecordCreateParams>): Promise<{ domain_record: DomainRecord }> {
    return this.client.patch<{ domain_record: DomainRecord }>(`/domains/${domainName}/records/${recordId}`, params);
  }

  /**
   * Delete a domain record
   */
  async deleteDomainRecord(domainName: string, recordId: number): Promise<void> {
    await this.client.delete(`/domains/${domainName}/records/${recordId}`);
  }

  // ============================================
  // Firewall Methods
  // ============================================

  /**
   * List firewalls
   */
  async listFirewalls(params?: {
    page?: number;
    per_page?: number;
  }): Promise<{ firewalls: Firewall[]; links: Links; meta: Meta }> {
    return this.client.get<{ firewalls: Firewall[]; links: Links; meta: Meta }>('/firewalls', params);
  }

  /**
   * Get a firewall
   */
  async getFirewall(firewallId: string): Promise<{ firewall: Firewall }> {
    return this.client.get<{ firewall: Firewall }>(`/firewalls/${firewallId}`);
  }

  /**
   * Create a firewall
   */
  async createFirewall(params: FirewallCreateParams): Promise<{ firewall: Firewall }> {
    return this.client.post<{ firewall: Firewall }>('/firewalls', params);
  }

  /**
   * Update a firewall
   */
  async updateFirewall(firewallId: string, params: Partial<FirewallCreateParams>): Promise<{ firewall: Firewall }> {
    return this.client.put<{ firewall: Firewall }>(`/firewalls/${firewallId}`, params);
  }

  /**
   * Delete a firewall
   */
  async deleteFirewall(firewallId: string): Promise<void> {
    await this.client.delete(`/firewalls/${firewallId}`);
  }

  // ============================================
  // Load Balancer Methods
  // ============================================

  /**
   * List load balancers
   */
  async listLoadBalancers(params?: {
    page?: number;
    per_page?: number;
  }): Promise<{ load_balancers: LoadBalancer[]; links: Links; meta: Meta }> {
    return this.client.get<{ load_balancers: LoadBalancer[]; links: Links; meta: Meta }>('/load_balancers', params);
  }

  /**
   * Get a load balancer
   */
  async getLoadBalancer(loadBalancerId: string): Promise<{ load_balancer: LoadBalancer }> {
    return this.client.get<{ load_balancer: LoadBalancer }>(`/load_balancers/${loadBalancerId}`);
  }

  /**
   * Delete a load balancer
   */
  async deleteLoadBalancer(loadBalancerId: string): Promise<void> {
    await this.client.delete(`/load_balancers/${loadBalancerId}`);
  }

  // ============================================
  // Database Methods
  // ============================================

  /**
   * List databases
   */
  async listDatabases(params?: {
    page?: number;
    per_page?: number;
  }): Promise<{ databases: Database[]; links: Links; meta: Meta }> {
    return this.client.get<{ databases: Database[]; links: Links; meta: Meta }>('/databases', params);
  }

  /**
   * Get a database
   */
  async getDatabase(databaseId: string): Promise<{ database: Database }> {
    return this.client.get<{ database: Database }>(`/databases/${databaseId}`);
  }

  /**
   * Create a database cluster
   */
  async createDatabase(params: DatabaseCreateParams): Promise<{ database: Database }> {
    return this.client.post<{ database: Database }>('/databases', params);
  }

  /**
   * Delete a database cluster
   */
  async deleteDatabase(databaseId: string): Promise<void> {
    await this.client.delete(`/databases/${databaseId}`);
  }

  // ============================================
  // Kubernetes Methods
  // ============================================

  /**
   * List Kubernetes clusters
   */
  async listKubernetesClusters(params?: {
    page?: number;
    per_page?: number;
  }): Promise<{ kubernetes_clusters: KubernetesCluster[]; links: Links; meta: Meta }> {
    return this.client.get<{ kubernetes_clusters: KubernetesCluster[]; links: Links; meta: Meta }>('/kubernetes/clusters', params);
  }

  /**
   * Get a Kubernetes cluster
   */
  async getKubernetesCluster(clusterId: string): Promise<{ kubernetes_cluster: KubernetesCluster }> {
    return this.client.get<{ kubernetes_cluster: KubernetesCluster }>(`/kubernetes/clusters/${clusterId}`);
  }

  /**
   * Delete a Kubernetes cluster
   */
  async deleteKubernetesCluster(clusterId: string): Promise<void> {
    await this.client.delete(`/kubernetes/clusters/${clusterId}`);
  }

  /**
   * Get kubeconfig for a cluster
   */
  async getKubeconfig(clusterId: string): Promise<string> {
    return this.client.get<string>(`/kubernetes/clusters/${clusterId}/kubeconfig`);
  }

  // ============================================
  // Project Methods
  // ============================================

  /**
   * List projects
   */
  async listProjects(params?: {
    page?: number;
    per_page?: number;
  }): Promise<{ projects: Project[]; links: Links; meta: Meta }> {
    return this.client.get<{ projects: Project[]; links: Links; meta: Meta }>('/projects', params);
  }

  /**
   * Get a project
   */
  async getProject(projectId: string): Promise<{ project: Project }> {
    return this.client.get<{ project: Project }>(`/projects/${projectId}`);
  }

  /**
   * Create a project
   */
  async createProject(params: ProjectCreateParams): Promise<{ project: Project }> {
    return this.client.post<{ project: Project }>('/projects', params);
  }

  /**
   * Update a project
   */
  async updateProject(projectId: string, params: Partial<ProjectCreateParams>): Promise<{ project: Project }> {
    return this.client.patch<{ project: Project }>(`/projects/${projectId}`, params);
  }

  /**
   * Delete a project
   */
  async deleteProject(projectId: string): Promise<void> {
    await this.client.delete(`/projects/${projectId}`);
  }

  /**
   * Get the default project
   */
  async getDefaultProject(): Promise<{ project: Project }> {
    return this.client.get<{ project: Project }>('/projects/default');
  }

  // ============================================
  // Snapshot Methods
  // ============================================

  /**
   * List snapshots
   */
  async listSnapshots(params?: {
    resource_type?: 'droplet' | 'volume';
    page?: number;
    per_page?: number;
  }): Promise<{ snapshots: Snapshot[]; links: Links; meta: Meta }> {
    return this.client.get<{ snapshots: Snapshot[]; links: Links; meta: Meta }>('/snapshots', params);
  }

  /**
   * Get a snapshot
   */
  async getSnapshot(snapshotId: string): Promise<{ snapshot: Snapshot }> {
    return this.client.get<{ snapshot: Snapshot }>(`/snapshots/${snapshotId}`);
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(snapshotId: string): Promise<void> {
    await this.client.delete(`/snapshots/${snapshotId}`);
  }

  // ============================================
  // Floating IP Methods
  // ============================================

  /**
   * List floating IPs
   */
  async listFloatingIPs(params?: {
    page?: number;
    per_page?: number;
  }): Promise<{ floating_ips: FloatingIP[]; links: Links; meta: Meta }> {
    return this.client.get<{ floating_ips: FloatingIP[]; links: Links; meta: Meta }>('/floating_ips', params);
  }

  /**
   * Get a floating IP
   */
  async getFloatingIP(ip: string): Promise<{ floating_ip: FloatingIP }> {
    return this.client.get<{ floating_ip: FloatingIP }>(`/floating_ips/${ip}`);
  }

  /**
   * Create a floating IP
   */
  async createFloatingIP(params: {
    region?: string;
    droplet_id?: number;
  }): Promise<{ floating_ip: FloatingIP }> {
    return this.client.post<{ floating_ip: FloatingIP }>('/floating_ips', params);
  }

  /**
   * Delete a floating IP
   */
  async deleteFloatingIP(ip: string): Promise<void> {
    await this.client.delete(`/floating_ips/${ip}`);
  }

  // ============================================
  // VPC Methods
  // ============================================

  /**
   * List VPCs
   */
  async listVPCs(params?: {
    page?: number;
    per_page?: number;
  }): Promise<{ vpcs: VPC[]; links: Links; meta: Meta }> {
    return this.client.get<{ vpcs: VPC[]; links: Links; meta: Meta }>('/vpcs', params);
  }

  /**
   * Get a VPC
   */
  async getVPC(vpcId: string): Promise<{ vpc: VPC }> {
    return this.client.get<{ vpc: VPC }>(`/vpcs/${vpcId}`);
  }

  /**
   * Create a VPC
   */
  async createVPC(params: VPCCreateParams): Promise<{ vpc: VPC }> {
    return this.client.post<{ vpc: VPC }>('/vpcs', params);
  }

  /**
   * Update a VPC
   */
  async updateVPC(vpcId: string, params: Partial<VPCCreateParams>): Promise<{ vpc: VPC }> {
    return this.client.patch<{ vpc: VPC }>(`/vpcs/${vpcId}`, params);
  }

  /**
   * Delete a VPC
   */
  async deleteVPC(vpcId: string): Promise<void> {
    await this.client.delete(`/vpcs/${vpcId}`);
  }

  // ============================================
  // Action Methods
  // ============================================

  /**
   * List all actions
   */
  async listActions(params?: {
    page?: number;
    per_page?: number;
  }): Promise<{ actions: Action[]; links: Links; meta: Meta }> {
    return this.client.get<{ actions: Action[]; links: Links; meta: Meta }>('/actions', params);
  }

  /**
   * Get an action
   */
  async getAction(actionId: number): Promise<{ action: Action }> {
    return this.client.get<{ action: Action }>(`/actions/${actionId}`);
  }
}

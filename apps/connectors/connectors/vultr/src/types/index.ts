// Vultr Connector Types

// ============================================
// Configuration
// ============================================

export interface VultrConfig {
  apiKey: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface MetaLinks {
  next?: string;
  prev?: string;
}

export interface Meta {
  total: number;
  links?: MetaLinks;
}

export interface PaginatedParams extends Record<string, string | number | boolean | undefined> {
  per_page?: number;
  cursor?: string;
}

// ============================================
// Error
// ============================================

export class VultrApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfter?: string,
  ) {
    super(message);
    this.name = 'VultrApiError';
  }
}

// ============================================
// Account Types
// ============================================

export interface Account {
  name: string;
  email: string;
  acls: string[];
  balance: number;
  pending_charges: number;
  last_payment_date?: string;
  last_payment_amount?: number;
}

// ============================================
// Region Types
// ============================================

export interface Region {
  id: string;
  city: string;
  country: string;
  continent: string;
  options: string[];
}

// ============================================
// Plan Types
// ============================================

export interface Plan {
  id: string;
  vcpu_count: number;
  ram: number;
  disk: number;
  disk_count: number;
  bandwidth: number;
  monthly_cost: number;
  type: string;
  locations: string[];
}

// ============================================
// Instance Types
// ============================================

export interface Instance {
  id: string;
  os: string;
  ram: number;
  disk: number;
  main_ip: string;
  vcpu_count: number;
  region: string;
  plan: string;
  date_created: string;
  status: string;
  allowed_bandwidth: number;
  netmask_v4?: string;
  gateway_v4?: string;
  power_status: string;
  server_status: string;
  v6_network?: string;
  v6_main_ip?: string;
  v6_network_size?: number;
  label: string;
  internal_ip?: string;
  kvm?: string;
  hostname: string;
  os_id?: number;
  app_id?: number;
  image_id?: string;
  snapshot_id?: string;
  firewall_group_id?: string;
  features?: string[];
  tags?: string[];
  user_scheme?: string;
  pending_charges?: number;
}

export interface InstanceCreateParams {
  region: string;
  plan: string;
  os_id?: number;
  iso_id?: string;
  snapshot_id?: string;
  app_id?: number;
  image_id?: string;
  label?: string;
  hostname?: string;
  enable_ipv6?: boolean;
  disable_public_ipv4?: boolean;
  sshkey_id?: string[];
  startup_script_id?: string;
  firewall_group_id?: string;
  tags?: string[];
  user_data?: string;
  ddos_protection?: boolean;
  activation_email?: boolean;
  backups?: string;
}

// ============================================
// SSH Key Types
// ============================================

export interface SSHKey {
  id: string;
  date_created: string;
  name: string;
  ssh_key: string;
}

export interface SSHKeyCreateParams {
  name: string;
  ssh_key: string;
}

// ============================================
// Snapshot Types
// ============================================

export interface Snapshot {
  id: string;
  date_created: string;
  description: string;
  size: number;
  status: string;
  os_id: number;
  app_id: number;
}

export interface SnapshotCreateParams {
  instance_id: string;
  description?: string;
}

// ============================================
// Block Storage Types
// ============================================

export interface Block {
  id: string;
  date_created: string;
  cost: number;
  status: string;
  size_gb: number;
  region: string;
  attached_to_instance?: string;
  label: string;
  mount_id?: string;
}

export interface BlockCreateParams {
  region: string;
  size_gb: number;
  label?: string;
}

// ============================================
// Firewall Types
// ============================================

export interface FirewallGroup {
  id: string;
  description: string;
  date_created: string;
  date_modified: string;
  instance_count: number;
  rule_count: number;
  max_rule_count: number;
}

export interface FirewallGroupCreateParams {
  description?: string;
}

export interface FirewallRule {
  id: number;
  type: string;
  ip_type: string;
  action: string;
  ip: string;
  subnet: string;
  subnet_size: number;
  port: string;
  protocol: string;
  notes: string;
  description: string;
}

export interface FirewallRuleCreateParams {
  ip_type: 'v4' | 'v6';
  protocol: 'icmp' | 'tcp' | 'udp' | 'gre' | 'esp' | 'ah';
  subnet: string;
  subnet_size: number;
  port?: string;
  source?: string;
  notes?: string;
}

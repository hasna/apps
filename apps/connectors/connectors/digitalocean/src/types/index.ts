// DigitalOcean Connector Types

// ============================================
// Configuration
// ============================================

export interface DigitalOceanConfig {
  apiKey: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface Links {
  pages?: {
    first?: string;
    prev?: string;
    next?: string;
    last?: string;
  };
}

export interface Meta {
  total: number;
}

// ============================================
// Account Types
// ============================================

export interface Account {
  droplet_limit: number;
  floating_ip_limit: number;
  email: string;
  uuid: string;
  email_verified: boolean;
  status: 'active' | 'warning' | 'locked';
  status_message: string;
  team?: {
    uuid: string;
    name: string;
  };
}

// ============================================
// Region Types
// ============================================

export interface Region {
  slug: string;
  name: string;
  sizes: string[];
  available: boolean;
  features: string[];
}

// ============================================
// Size Types
// ============================================

export interface Size {
  slug: string;
  memory: number;
  vcpus: number;
  disk: number;
  transfer: number;
  price_monthly: number;
  price_hourly: number;
  regions: string[];
  available: boolean;
  description: string;
}

// ============================================
// Droplet Types
// ============================================

export interface Droplet {
  id: number;
  name: string;
  memory: number;
  vcpus: number;
  disk: number;
  locked: boolean;
  status: 'new' | 'active' | 'off' | 'archive';
  kernel?: {
    id: number;
    name: string;
    version: string;
  };
  created_at: string;
  features: string[];
  backup_ids: number[];
  next_backup_window?: {
    start: string;
    end: string;
  };
  snapshot_ids: number[];
  image: Image;
  volume_ids: string[];
  size: Size;
  size_slug: string;
  networks: {
    v4: NetworkV4[];
    v6: NetworkV6[];
  };
  region: Region;
  tags: string[];
  vpc_uuid?: string;
}

export interface NetworkV4 {
  ip_address: string;
  netmask: string;
  gateway: string;
  type: 'public' | 'private';
}

export interface NetworkV6 {
  ip_address: string;
  netmask: number;
  gateway: string;
  type: 'public' | 'private';
}

export interface DropletCreateParams {
  name: string;
  region: string;
  size: string;
  image: string | number;
  ssh_keys?: (string | number)[];
  backups?: boolean;
  ipv6?: boolean;
  vpc_uuid?: string;
  private_networking?: boolean;
  monitoring?: boolean;
  user_data?: string;
  volumes?: string[];
  tags?: string[];
  with_droplet_agent?: boolean;
}

// ============================================
// Image Types
// ============================================

export interface Image {
  id: number;
  name: string;
  type: 'snapshot' | 'backup' | 'custom';
  distribution: string;
  slug?: string;
  public: boolean;
  regions: string[];
  created_at: string;
  min_disk_size: number;
  size_gigabytes: number;
  description?: string;
  tags?: string[];
  status: 'NEW' | 'available' | 'pending' | 'deleted';
  error_message?: string;
}

// ============================================
// SSH Key Types
// ============================================

export interface SSHKey {
  id: number;
  fingerprint: string;
  public_key: string;
  name: string;
}

export interface SSHKeyCreateParams {
  name: string;
  public_key: string;
}

// ============================================
// Volume Types
// ============================================

export interface Volume {
  id: string;
  region: Region;
  droplet_ids: number[];
  name: string;
  description: string;
  size_gigabytes: number;
  created_at: string;
  filesystem_type?: string;
  filesystem_label?: string;
  tags?: string[];
}

export interface VolumeCreateParams {
  size_gigabytes: number;
  name: string;
  description?: string;
  region: string;
  snapshot_id?: string;
  filesystem_type?: string;
  filesystem_label?: string;
  tags?: string[];
}

// ============================================
// Domain Types
// ============================================

export interface Domain {
  name: string;
  ttl?: number;
  zone_file?: string;
}

export interface DomainRecord {
  id: number;
  type: 'A' | 'AAAA' | 'CAA' | 'CNAME' | 'MX' | 'NS' | 'SOA' | 'SRV' | 'TXT';
  name: string;
  data: string;
  priority?: number;
  port?: number;
  ttl?: number;
  weight?: number;
  flags?: number;
  tag?: string;
}

export interface DomainRecordCreateParams {
  type: DomainRecord['type'];
  name: string;
  data: string;
  priority?: number;
  port?: number;
  ttl?: number;
  weight?: number;
  flags?: number;
  tag?: string;
}

// ============================================
// Firewall Types
// ============================================

export interface Firewall {
  id: string;
  status: 'waiting' | 'succeeded' | 'failed';
  created_at: string;
  pending_changes: Array<{
    droplet_id: number;
    removing: boolean;
    status: string;
  }>;
  name: string;
  inbound_rules: FirewallRule[];
  outbound_rules: FirewallRule[];
  droplet_ids: number[];
  tags: string[];
}

export interface FirewallRule {
  protocol: 'tcp' | 'udp' | 'icmp';
  ports: string;
  sources?: FirewallRuleTarget;
  destinations?: FirewallRuleTarget;
}

export interface FirewallRuleTarget {
  addresses?: string[];
  droplet_ids?: number[];
  load_balancer_uids?: string[];
  kubernetes_ids?: string[];
  tags?: string[];
}

export interface FirewallCreateParams {
  name: string;
  inbound_rules?: FirewallRule[];
  outbound_rules?: FirewallRule[];
  droplet_ids?: number[];
  tags?: string[];
}

// ============================================
// Load Balancer Types
// ============================================

export interface LoadBalancer {
  id: string;
  name: string;
  ip: string;
  size?: 'lb-small' | 'lb-medium' | 'lb-large';
  size_unit?: number;
  algorithm: 'round_robin' | 'least_connections';
  status: 'new' | 'active' | 'errored';
  created_at: string;
  forwarding_rules: ForwardingRule[];
  health_check: HealthCheck;
  sticky_sessions: StickySessions;
  region: Region;
  tag?: string;
  droplet_ids: number[];
  redirect_http_to_https: boolean;
  enable_proxy_protocol: boolean;
  enable_backend_keepalive: boolean;
  vpc_uuid?: string;
  disable_lets_encrypt_dns_records?: boolean;
  project_id?: string;
  http_idle_timeout_seconds?: number;
  firewall?: {
    deny: string[];
    allow: string[];
  };
}

export interface ForwardingRule {
  entry_protocol: 'http' | 'https' | 'http2' | 'http3' | 'tcp' | 'udp';
  entry_port: number;
  target_protocol: 'http' | 'https' | 'http2' | 'tcp' | 'udp';
  target_port: number;
  certificate_id?: string;
  tls_passthrough?: boolean;
}

export interface HealthCheck {
  protocol: 'http' | 'https' | 'tcp';
  port: number;
  path?: string;
  check_interval_seconds?: number;
  response_timeout_seconds?: number;
  unhealthy_threshold?: number;
  healthy_threshold?: number;
}

export interface StickySessions {
  type: 'none' | 'cookies';
  cookie_name?: string;
  cookie_ttl_seconds?: number;
}

// ============================================
// Database Types
// ============================================

export interface Database {
  id: string;
  name: string;
  engine: 'pg' | 'mysql' | 'redis' | 'mongodb' | 'kafka' | 'opensearch';
  version: string;
  semantic_version?: string;
  connection: DatabaseConnection;
  private_connection?: DatabaseConnection;
  users: DatabaseUser[];
  db_names: string[];
  num_nodes: number;
  size: string;
  region: string;
  status: 'creating' | 'online' | 'resizing' | 'migrating' | 'forking';
  created_at: string;
  maintenance_window?: {
    day: string;
    hour: string;
    pending: boolean;
    description: string[];
  };
  tags?: string[];
  private_network_uuid?: string;
  project_id?: string;
}

export interface DatabaseConnection {
  protocol: string;
  uri: string;
  database: string;
  host: string;
  port: number;
  user: string;
  password: string;
  ssl: boolean;
}

export interface DatabaseUser {
  name: string;
  role?: 'primary' | 'normal';
  password?: string;
}

export interface DatabaseCreateParams {
  name: string;
  engine: Database['engine'];
  version?: string;
  size: string;
  region: string;
  num_nodes: number;
  tags?: string[];
  private_network_uuid?: string;
  project_id?: string;
}

// ============================================
// Kubernetes Types
// ============================================

export interface KubernetesCluster {
  id: string;
  name: string;
  region: string;
  version: string;
  cluster_subnet: string;
  service_subnet: string;
  vpc_uuid: string;
  ipv4: string;
  endpoint: string;
  tags: string[];
  node_pools: KubernetesNodePool[];
  maintenance_policy: {
    start_time: string;
    duration: string;
    day: string;
  };
  auto_upgrade: boolean;
  status: {
    state: 'running' | 'provisioning' | 'degraded' | 'error' | 'deleted' | 'upgrading' | 'deleting';
    message?: string;
  };
  created_at: string;
  updated_at: string;
  surge_upgrade: boolean;
  ha: boolean;
  registry_enabled: boolean;
}

export interface KubernetesNodePool {
  id: string;
  name: string;
  size: string;
  count: number;
  tags: string[];
  labels?: Record<string, string>;
  taints?: Array<{
    key: string;
    value: string;
    effect: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute';
  }>;
  auto_scale: boolean;
  min_nodes?: number;
  max_nodes?: number;
  nodes: Array<{
    id: string;
    name: string;
    status: {
      state: string;
    };
    droplet_id: string;
    created_at: string;
    updated_at: string;
  }>;
}

// ============================================
// Project Types
// ============================================

export interface Project {
  id: string;
  owner_id: number;
  owner_uuid: string;
  name: string;
  description: string;
  purpose: string;
  environment: 'Development' | 'Staging' | 'Production';
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreateParams {
  name: string;
  description?: string;
  purpose?: string;
  environment?: Project['environment'];
}

// ============================================
// Snapshot Types
// ============================================

export interface Snapshot {
  id: string;
  name: string;
  regions: string[];
  created_at: string;
  resource_id: string;
  resource_type: 'droplet' | 'volume';
  min_disk_size: number;
  size_gigabytes: number;
  tags: string[];
}

// ============================================
// Action Types
// ============================================

export interface Action {
  id: number;
  status: 'in-progress' | 'completed' | 'errored';
  type: string;
  started_at: string;
  completed_at?: string;
  resource_id: number;
  resource_type: string;
  region?: Region;
  region_slug?: string;
}

// ============================================
// Floating IP Types
// ============================================

export interface FloatingIP {
  ip: string;
  region: Region;
  droplet?: Droplet;
  locked: boolean;
  project_id?: string;
}

// ============================================
// VPC Types
// ============================================

export interface VPC {
  id: string;
  urn: string;
  name: string;
  description?: string;
  region: string;
  ip_range: string;
  default: boolean;
  created_at: string;
}

export interface VPCCreateParams {
  name: string;
  description?: string;
  region: string;
  ip_range?: string;
}

// ============================================
// API Error Types
// ============================================

export interface DigitalOceanErrorResponse {
  id: string;
  message: string;
  request_id?: string;
}

export class DigitalOceanApiError extends Error {
  public readonly statusCode: number;
  public readonly requestId?: string;

  constructor(message: string, statusCode: number, requestId?: string) {
    super(message);
    this.name = 'DigitalOceanApiError';
    this.statusCode = statusCode;
    this.requestId = requestId;
  }
}

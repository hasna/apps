// Cloudflare API Types

// ============================================
// Configuration
// ============================================

export interface CloudflareConfig {
  apiToken?: string;
  apiKey?: string;
  email?: string;
  accountId?: string;
  baseUrl?: string;
}

export interface CliConfig {
  apiToken?: string;
  apiKey?: string;
  email?: string;
  accountId?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

export interface CloudflareResponse<T> {
  success: boolean;
  errors: CloudflareError[];
  messages: string[];
  result: T;
  result_info?: ResultInfo;
}

export interface ResultInfo {
  page: number;
  per_page: number;
  total_pages: number;
  count: number;
  total_count: number;
}

// ============================================
// Account Types
// ============================================

export interface Account {
  id: string;
  name: string;
  type: string;
  settings?: AccountSettings;
  created_on?: string;
}

export interface AccountSettings {
  enforce_twofactor: boolean;
  access_approval_expiry?: string;
}

// ============================================
// Zone Types
// ============================================

export interface Zone {
  id: string;
  name: string;
  status: 'active' | 'pending' | 'initializing' | 'moved' | 'deleted' | 'deactivated' | 'read only';
  paused: boolean;
  type: 'full' | 'partial' | 'secondary';
  development_mode: number;
  name_servers: string[];
  original_name_servers?: string[];
  original_registrar?: string;
  original_dnshost?: string;
  modified_on: string;
  created_on: string;
  activated_on?: string;
  meta?: ZoneMeta;
  owner?: ZoneOwner;
  account: {
    id: string;
    name: string;
  };
  permissions?: string[];
  plan?: ZonePlan;
}

export interface ZoneMeta {
  step: number;
  custom_certificate_quota: number;
  page_rule_quota: number;
  phishing_detected: boolean;
  multiple_railguns_allowed: boolean;
}

export interface ZoneOwner {
  id: string;
  type: string;
  email?: string;
}

export interface ZonePlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  frequency: string;
  is_subscribed: boolean;
  can_subscribe: boolean;
  legacy_id: string;
  legacy_discount: boolean;
  externally_managed: boolean;
}

export interface CreateZoneParams {
  name: string;
  account: {
    id: string;
  };
  type?: 'full' | 'partial' | 'secondary';
  jump_start?: boolean;
}

export interface ZoneSettings {
  id: string;
  value: string | boolean | number | object;
  editable: boolean;
  modified_on?: string;
}

// ============================================
// DNS Record Types
// ============================================

export interface DNSRecord {
  id: string;
  zone_id: string;
  zone_name: string;
  name: string;
  type: DNSRecordType;
  content: string;
  proxiable: boolean;
  proxied: boolean;
  ttl: number;
  locked: boolean;
  meta?: DNSRecordMeta;
  comment?: string;
  tags?: string[];
  created_on: string;
  modified_on: string;
  priority?: number;
  data?: Record<string, unknown>;
}

export type DNSRecordType =
  | 'A'
  | 'AAAA'
  | 'CNAME'
  | 'TXT'
  | 'MX'
  | 'NS'
  | 'SRV'
  | 'CAA'
  | 'CERT'
  | 'DNSKEY'
  | 'DS'
  | 'HTTPS'
  | 'LOC'
  | 'NAPTR'
  | 'PTR'
  | 'SMIMEA'
  | 'SSHFP'
  | 'SVCB'
  | 'TLSA'
  | 'URI';

export interface DNSRecordMeta {
  auto_added: boolean;
  managed_by_apps: boolean;
  managed_by_argo_tunnel: boolean;
  source: string;
}

export interface CreateDNSRecordParams {
  type: DNSRecordType;
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
  proxied?: boolean;
  comment?: string;
  tags?: string[];
  data?: Record<string, unknown>;
}

export interface UpdateDNSRecordParams extends Partial<CreateDNSRecordParams> {
  id: string;
}

export interface ListDNSRecordsParams {
  type?: DNSRecordType;
  name?: string;
  content?: string;
  proxied?: boolean;
  page?: number;
  per_page?: number;
  order?: 'type' | 'name' | 'content' | 'ttl' | 'proxied';
  direction?: 'asc' | 'desc';
  match?: 'any' | 'all';
  comment?: string;
  tag?: string;
}

// ============================================
// Workers Types
// ============================================

export interface Worker {
  id: string;
  etag: string;
  handlers: string[];
  named_handlers?: WorkerHandler[];
  modified_on: string;
  created_on: string;
  usage_model?: 'bundled' | 'unbound';
  compatibility_date?: string;
  compatibility_flags?: string[];
}

export interface WorkerHandler {
  name: string;
  handlers: string[];
}

export interface WorkerScript {
  id: string;
  etag: string;
  script: string;
  modified_on: string;
}

export interface WorkerRoute {
  id: string;
  pattern: string;
  script?: string;
}

export interface WorkerBinding {
  name: string;
  type: 'kv_namespace' | 'r2_bucket' | 'durable_object_namespace' | 'service' | 'plain_text' | 'secret_text' | 'wasm_module';
  namespace_id?: string;
  bucket_name?: string;
  text?: string;
}

export interface CreateWorkerParams {
  script: string;
  bindings?: WorkerBinding[];
  compatibility_date?: string;
  compatibility_flags?: string[];
  usage_model?: 'bundled' | 'unbound';
}

export interface WorkerDeployment {
  id: string;
  source: string;
  strategy: string;
  author_email: string;
  created_on: string;
  annotations?: Record<string, string>;
  versions?: WorkerVersion[];
}

export interface WorkerVersion {
  version_id: string;
  percentage: number;
}

// ============================================
// Pages Types
// ============================================

export interface PagesProject {
  id: string;
  name: string;
  subdomain: string;
  domains: string[];
  source?: PagesSource;
  build_config?: PagesBuildConfig;
  deployment_configs?: PagesDeploymentConfigs;
  latest_deployment?: PagesDeployment;
  canonical_deployment?: PagesDeployment;
  production_branch: string;
  created_on: string;
  production_script_name?: string;
}

export interface PagesSource {
  type: 'github' | 'gitlab';
  config: {
    owner: string;
    repo_name: string;
    production_branch: string;
    pr_comments_enabled?: boolean;
    deployments_enabled?: boolean;
    production_deployments_enabled?: boolean;
    preview_deployment_setting?: 'all' | 'none' | 'custom';
    preview_branch_includes?: string[];
    preview_branch_excludes?: string[];
  };
}

export interface PagesBuildConfig {
  build_command?: string;
  destination_dir?: string;
  root_dir?: string;
  web_analytics_tag?: string;
  web_analytics_token?: string;
}

export interface PagesDeploymentConfigs {
  preview: PagesDeploymentConfig;
  production: PagesDeploymentConfig;
}

export interface PagesDeploymentConfig {
  env_vars?: Record<string, { value: string; type?: 'plain_text' | 'secret_text' }>;
  compatibility_date?: string;
  compatibility_flags?: string[];
  d1_databases?: Record<string, { id: string }>;
  durable_object_namespaces?: Record<string, { namespace_id: string }>;
  kv_namespaces?: Record<string, { namespace_id: string }>;
  r2_buckets?: Record<string, { name: string }>;
  services?: Record<string, { service: string; environment: string }>;
}

export interface PagesDeployment {
  id: string;
  short_id: string;
  project_id: string;
  project_name: string;
  environment: 'preview' | 'production';
  url: string;
  created_on: string;
  modified_on: string;
  latest_stage?: PagesDeploymentStage;
  deployment_trigger?: {
    type: 'ad_hoc' | 'github' | 'gitlab';
    metadata?: {
      branch: string;
      commit_hash: string;
      commit_message: string;
    };
  };
  stages?: PagesDeploymentStage[];
  build_config?: PagesBuildConfig;
  source?: PagesSource;
  env_vars?: Record<string, { value: string; type?: string }>;
  aliases?: string[];
  is_skipped?: boolean;
  production_branch?: string;
}

export interface PagesDeploymentStage {
  name: 'queued' | 'initialize' | 'clone_repo' | 'build' | 'deploy';
  status: 'idle' | 'active' | 'canceled' | 'success' | 'failure' | 'skipped';
  started_on?: string;
  ended_on?: string;
}

export interface CreatePagesProjectParams {
  name: string;
  production_branch?: string;
  build_config?: PagesBuildConfig;
  source?: PagesSource;
}

// ============================================
// KV Types
// ============================================

export interface KVNamespace {
  id: string;
  title: string;
  supports_url_encoding?: boolean;
}

export interface KVKey {
  name: string;
  expiration?: number;
  metadata?: Record<string, unknown>;
}

export interface KVKeyValue {
  name: string;
  value: string;
  metadata?: Record<string, unknown>;
  expiration?: number;
  expiration_ttl?: number;
}

export interface CreateKVNamespaceParams {
  title: string;
}

export interface ListKVKeysParams {
  limit?: number;
  cursor?: string;
  prefix?: string;
}

export interface WriteKVParams {
  key: string;
  value: string;
  expiration?: number;
  expiration_ttl?: number;
  metadata?: Record<string, unknown>;
}

export interface BulkWriteKVParams {
  key: string;
  value: string;
  expiration?: number;
  expiration_ttl?: number;
  metadata?: Record<string, unknown>;
  base64?: boolean;
}

// ============================================
// R2 Types
// ============================================

export interface R2Bucket {
  name: string;
  creation_date: string;
  location?: string;
}

export interface R2Object {
  key: string;
  size: number;
  etag: string;
  http_etag: string;
  uploaded: string;
  storage_class?: string;
  checksums?: {
    md5?: string;
  };
  custom_metadata?: Record<string, string>;
}

export interface R2ObjectList {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimited_prefixes?: string[];
}

export interface CreateR2BucketParams {
  name: string;
  locationHint?: string;
}

export interface ListR2ObjectsParams {
  prefix?: string;
  delimiter?: string;
  cursor?: string;
  limit?: number;
  include?: ('httpMetadata' | 'customMetadata')[];
}

export interface PutR2ObjectParams {
  key: string;
  body: string | Buffer | ReadableStream;
  contentType?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  cacheControl?: string;
  customMetadata?: Record<string, string>;
}

// ============================================
// Cache Types
// ============================================

export interface CachePurgeParams {
  files?: string[];
  tags?: string[];
  hosts?: string[];
  prefixes?: string[];
}

export interface CachePurgeResponse {
  id: string;
}

// ============================================
// Analytics Types
// ============================================

export interface AnalyticsQuery {
  since?: string;
  until?: string;
  continuous?: boolean;
}

export interface ZoneAnalytics {
  totals: AnalyticsTotals;
  timeseries: AnalyticsTimeseries[];
}

export interface AnalyticsTotals {
  requests: {
    all: number;
    cached: number;
    uncached: number;
    content_type: Record<string, number>;
    country: Record<string, number>;
    ssl: {
      encrypted: number;
      unencrypted: number;
    };
    http_status: Record<string, number>;
  };
  bandwidth: {
    all: number;
    cached: number;
    uncached: number;
    content_type: Record<string, number>;
    country: Record<string, number>;
    ssl: {
      encrypted: number;
      unencrypted: number;
    };
  };
  threats: {
    all: number;
    country: Record<string, number>;
    type: Record<string, number>;
  };
  pageviews: {
    all: number;
    search_engines: Record<string, number>;
  };
  uniques: {
    all: number;
  };
}

export interface AnalyticsTimeseries {
  since: string;
  until: string;
  requests: {
    all: number;
    cached: number;
    uncached: number;
    content_type: Record<string, number>;
    country: Record<string, number>;
    ssl: {
      encrypted: number;
      unencrypted: number;
    };
    http_status: Record<string, number>;
  };
  bandwidth: {
    all: number;
    cached: number;
    uncached: number;
    content_type: Record<string, number>;
    country: Record<string, number>;
    ssl: {
      encrypted: number;
      unencrypted: number;
    };
  };
  threats: {
    all: number;
    country: Record<string, number>;
    type: Record<string, number>;
  };
  pageviews: {
    all: number;
    search_engines: Record<string, number>;
  };
  uniques: {
    all: number;
  };
}

// ============================================
// Firewall Types
// ============================================

export interface FirewallRule {
  id: string;
  paused: boolean;
  description: string;
  action: FirewallAction;
  priority?: number;
  filter: FirewallFilter;
  products?: string[];
  ref?: string;
  created_on: string;
  modified_on: string;
}

export type FirewallAction =
  | 'block'
  | 'challenge'
  | 'js_challenge'
  | 'managed_challenge'
  | 'allow'
  | 'log'
  | 'bypass';

export interface FirewallFilter {
  id: string;
  expression: string;
  paused: boolean;
  description?: string;
  ref?: string;
}

export interface CreateFirewallRuleParams {
  filter: {
    expression: string;
    description?: string;
  };
  action: FirewallAction;
  description?: string;
  priority?: number;
  paused?: boolean;
  products?: string[];
  ref?: string;
}

export interface WAFRule {
  id: string;
  description: string;
  priority: number;
  group: {
    id: string;
    name: string;
  };
  package_id: string;
  allowed_modes: string[];
  mode: string;
  default_mode: string;
}

// ============================================
// SSL Types
// ============================================

export interface SSLCertificate {
  id: string;
  type: string;
  hosts: string[];
  primary_certificate?: string;
  status: string;
  certificates?: CertificateInfo[];
  issuer?: string;
  signature?: string;
  serial_number?: string;
  uploaded_on?: string;
  modified_on?: string;
  expires_on?: string;
  bundle_method?: string;
  geo_restrictions?: {
    label: string;
  };
}

export interface CertificateInfo {
  id: string;
  hosts: string[];
  issuer: string;
  signature: string;
  status: string;
  bundle_method: string;
  zone_id: string;
  uploaded_on: string;
  modified_on: string;
  expires_on: string;
  priority: number;
}

export interface SSLSettings {
  id: string;
  value: string;
  editable: boolean;
  modified_on?: string;
}

export interface SSLVerification {
  certificate_status: string;
  verification_type: string;
  verification_status: string;
  verification_info?: Record<string, string>;
  brand_check?: boolean;
  cert_pack_uuid?: string;
  validation_method?: string;
}

export interface CreateSSLCertificateParams {
  certificate: string;
  private_key: string;
  bundle_method?: 'ubiquitous' | 'optimal' | 'force';
  geo_restrictions?: {
    label: 'us' | 'eu' | 'highest_security';
  };
  type?: 'legacy_custom' | 'sni_custom';
}

export interface OriginCACertificate {
  id: string;
  certificate: string;
  hostnames: string[];
  expires_on: string;
  request_type: 'origin-rsa' | 'origin-ecc' | 'keyless-certificate';
  requested_validity: number;
  csr: string;
}

export interface CreateOriginCACertificateParams {
  hostnames: string[];
  requested_validity?: number;
  request_type?: 'origin-rsa' | 'origin-ecc';
  csr?: string;
}

// ============================================
// API Error Types
// ============================================

export interface CloudflareError {
  code: number;
  message: string;
  error_chain?: CloudflareError[];
}

export class CloudflareApiError extends Error {
  public readonly statusCode: number;
  public readonly errors: CloudflareError[];

  constructor(message: string, statusCode: number, errors: CloudflareError[] = []) {
    super(message);
    this.name = 'CloudflareApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

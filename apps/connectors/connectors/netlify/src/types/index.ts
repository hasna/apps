// Netlify Connector Types

// ============================================
// Configuration
// ============================================

export interface NetlifyConfig {
  apiKey: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Account Types
// ============================================

export interface Account {
  id: string;
  name: string;
  slug: string;
  type: string;
  capabilities?: {
    sites?: { included: number; used: number };
    collaborators?: { included: number; used: number };
  };
  billing_name?: string;
  billing_email?: string;
  billing_details?: string;
  billing_period?: string;
  payment_method_id?: string;
  type_name?: string;
  type_id?: string;
  owner_ids?: string[];
  roles_allowed?: string[];
  created_at?: string;
  updated_at?: string;
}

// ============================================
// Site Types
// ============================================

export interface Site {
  id: string;
  state: string;
  plan?: string;
  name: string;
  custom_domain?: string;
  domain_aliases?: string[];
  branch_deploy_custom_domain?: string;
  deploy_preview_custom_domain?: string;
  password?: string;
  notification_email?: string;
  url: string;
  ssl_url: string;
  admin_url: string;
  screenshot_url?: string;
  created_at: string;
  updated_at: string;
  user_id?: string;
  session_id?: string;
  ssl?: boolean;
  force_ssl?: boolean;
  managed_dns?: boolean;
  deploy_url?: string;
  published_deploy?: Deploy;
  account_name?: string;
  account_slug?: string;
  git_provider?: string;
  deploy_hook?: string;
  capabilities?: Record<string, unknown>;
  processing_settings?: {
    skip?: boolean;
    css?: { bundle?: boolean; minify?: boolean };
    js?: { bundle?: boolean; minify?: boolean };
    images?: { optimize?: boolean };
    html?: { pretty_urls?: boolean };
  };
  build_settings?: {
    id?: number;
    provider?: string;
    deploy_key_id?: string;
    repo_path?: string;
    repo_branch?: string;
    dir?: string;
    functions_dir?: string;
    cmd?: string;
    allowed_branches?: string[];
    public_repo?: boolean;
    private_logs?: boolean;
    repo_url?: string;
    env?: Record<string, string>;
    installation_id?: number;
    stop_builds?: boolean;
  };
  id_domain?: string;
  default_hooks_data?: {
    access_token?: string;
  };
  build_image?: string;
  prerender?: string;
  functions_region?: string;
}

export interface SiteCreateParams {
  name?: string;
  custom_domain?: string;
  password?: string;
  force_ssl?: boolean;
  processing_settings?: Site['processing_settings'];
  repo?: {
    provider?: string;
    id?: number;
    repo?: string;
    private?: boolean;
    branch?: string;
    cmd?: string;
    dir?: string;
    functions_dir?: string;
    deploy_key_id?: string;
    installation_id?: number;
  };
  account_slug?: string;
}

// ============================================
// Deploy Types
// ============================================

export type DeployState = 'new' | 'pending_review' | 'accepted' | 'building' | 'enqueued' | 'uploading' | 'uploaded' | 'preparing' | 'prepared' | 'processing' | 'ready' | 'error' | 'retrying';

export interface Deploy {
  id: string;
  site_id: string;
  user_id?: string;
  build_id?: string;
  state: DeployState;
  name: string;
  url: string;
  ssl_url: string;
  admin_url: string;
  deploy_url: string;
  deploy_ssl_url: string;
  screenshot_url?: string;
  review_id?: number;
  draft?: boolean;
  required?: string[];
  required_functions?: string[];
  error_message?: string;
  branch?: string;
  commit_ref?: string;
  commit_url?: string;
  skipped?: boolean;
  created_at: string;
  updated_at: string;
  published_at?: string;
  title?: string;
  context?: string;
  locked?: boolean;
  review_url?: string;
  site_capabilities?: {
    large_media_enabled?: boolean;
  };
  framework?: string;
  function_schedules?: Array<{
    name: string;
    cron: string;
  }>;
  plugin_state?: string;
  lighthouse_plugin_scores?: Record<string, number>;
  links?: {
    permalink?: string;
    alias?: string;
  };
}

// ============================================
// Form Types
// ============================================

export interface Form {
  id: string;
  site_id: string;
  name: string;
  paths?: string[];
  submission_count: number;
  fields?: string[];
  created_at: string;
}

export interface FormSubmission {
  id: string;
  number: number;
  email?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  summary?: string;
  body?: string;
  data: Record<string, unknown>;
  created_at: string;
  site_url?: string;
  form_id: string;
  form_name: string;
}

// ============================================
// DNS Zone Types
// ============================================

export interface DnsZone {
  id: string;
  name: string;
  errors?: string[];
  supported_record_types?: string[];
  user_id?: string;
  created_at?: string;
  updated_at?: string;
  records?: DnsRecord[];
  dns_servers?: string[];
  account_id?: string;
  site_id?: string;
  account_slug?: string;
  account_name?: string;
  domain?: string;
  ipv6_enabled?: boolean;
  dedicated?: boolean;
}

export interface DnsRecord {
  id: string;
  hostname: string;
  type: 'A' | 'AAAA' | 'ALIAS' | 'CAA' | 'CNAME' | 'MX' | 'NS' | 'SPF' | 'SRV' | 'TXT' | 'NETLIFY' | 'NETLIFYv6';
  value: string;
  ttl?: number;
  priority?: number;
  dns_zone_id: string;
  site_id?: string;
  flag?: number;
  tag?: string;
  managed?: boolean;
}

export interface DnsRecordCreateParams {
  type: DnsRecord['type'];
  hostname: string;
  value: string;
  ttl?: number;
  priority?: number;
  weight?: number;
  port?: number;
  flag?: number;
  tag?: string;
}

// ============================================
// Build Types
// ============================================

export interface Build {
  id: string;
  deploy_id: string;
  sha?: string;
  done: boolean;
  error?: string;
  created_at: string;
}

// ============================================
// Hook Types
// ============================================

export interface Hook {
  id: string;
  site_id: string;
  type: string;
  event: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  disabled?: boolean;
}

export interface HookCreateParams {
  site_id: string;
  type: string;
  event: string;
  data: Record<string, unknown>;
}

// ============================================
// Deploy Key Types
// ============================================

export interface DeployKey {
  id: string;
  public_key: string;
  created_at: string;
}

// ============================================
// Environment Variable Types
// ============================================

export interface EnvVar {
  key: string;
  scopes: ('builds' | 'functions' | 'runtime' | 'post_processing')[];
  values: EnvVarValue[];
  is_secret?: boolean;
  updated_at?: string;
  updated_by?: {
    id?: string;
    full_name?: string;
    email?: string;
    avatar_url?: string;
  };
}

export interface EnvVarValue {
  id?: string;
  value: string;
  context: 'all' | 'dev' | 'branch-deploy' | 'deploy-preview' | 'production' | 'branch';
  context_parameter?: string;
}

export interface EnvVarCreateParams {
  key: string;
  values: EnvVarValue[];
  is_secret?: boolean;
  scopes?: EnvVar['scopes'];
}

// ============================================
// Function Types
// ============================================

export interface NetlifyFunction {
  id: string;
  name: string;
  sha?: string;
  created_at?: string;
}

// ============================================
// Snippet Types
// ============================================

export interface Snippet {
  id: number;
  site_id: string;
  title: string;
  general?: string;
  general_position?: string;
  goal?: string;
  goal_position?: string;
}

// ============================================
// Split Test Types
// ============================================

export interface SplitTest {
  id: string;
  site_id: string;
  name?: string;
  path: string;
  branches: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
  active: boolean;
  created_at?: string;
  updated_at?: string;
  unpublished_at?: string;
}

// ============================================
// User Types
// ============================================

export interface User {
  id: string;
  uid?: string;
  full_name?: string;
  avatar_url?: string;
  email: string;
  affiliate_id?: string;
  site_count?: number;
  created_at: string;
  last_login?: string;
  login_providers?: string[];
  onboarding_progress?: {
    slides?: string;
  };
  mfa_enabled?: boolean;
}

// ============================================
// API Error Types
// ============================================

export interface NetlifyErrorResponse {
  message: string;
  code?: number;
}

export class NetlifyApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: number;

  constructor(message: string, statusCode: number, code?: number) {
    super(message);
    this.name = 'NetlifyApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

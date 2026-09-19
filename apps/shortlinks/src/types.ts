export interface Domain {
  id: string;
  hostname: string;
  provider: string;
  default_domain: boolean;
  origin_url: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  machine_id: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Link {
  /** Stable opaque database identity. This is not the public short code. */
  id: string;
  domain_id: string;
  hostname: string;
  /** Public root-path code or friendly alias, for example `aZ3` or `friendly-link`. */
  slug: string;
  destination_url: string;
  title: string | null;
  active: boolean;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  machine_id: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
  short_url?: string;
}

export interface Click {
  id: string;
  link_id: string;
  domain_id: string;
  slug: string;
  clicked_at: string;
  ip_hash: string | null;
  user_agent: string | null;
  referer: string | null;
  country: string | null;
  city: string | null;
  metadata: Record<string, unknown>;
  machine_id: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LinkStats {
  link: Link;
  clicks: number;
  last_clicked_at: string | null;
  top_referrers: Array<{ referer: string | null; clicks: number }>;
  top_user_agents: Array<{ user_agent: string | null; clicks: number }>;
}

export interface CreateLinkInput {
  destinationUrl: string;
  domain?: string;
  slug?: string;
  title?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
  /** Minimum generated-code length. Values below 3 are clamped to 3. */
  slugLength?: number;
}

/** Internal domain-row write. Custom hostnames must be Domains API projections. */
export interface AddDomainInput {
  hostname: string;
  provider?: string;
  defaultDomain?: boolean;
  originUrl?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

/** Business intent sent to Shortlinks; provider implementation stays in Domains. */
export interface ProvisionDomainInput {
  hostname: string;
  maxPriceUsd: number;
  years: number;
  autoRenew: boolean;
  defaultDomain?: boolean;
  idempotencyKey: string;
}

export interface DomainReconciliationResult {
  domain: Domain;
  provisioning?: Record<string, unknown>;
}

export interface ClickInput {
  ip?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  country?: string | null;
  city?: string | null;
  metadata?: Record<string, unknown>;
}

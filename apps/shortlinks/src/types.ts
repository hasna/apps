export interface Domain {
  id: string;
  hostname: string;
  provider: string;
  default_domain: boolean;
  cloudflare_zone_id: string | null;
  cloudflare_account_id: string | null;
  cloudflare_worker_name: string | null;
  origin_url: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  machine_id: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Link {
  id: string;
  domain_id: string;
  hostname: string;
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
  slugLength?: number;
}

export interface AddDomainInput {
  hostname: string;
  provider?: string;
  defaultDomain?: boolean;
  cloudflareZoneId?: string;
  cloudflareAccountId?: string;
  cloudflareWorkerName?: string;
  originUrl?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface ClickInput {
  ip?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  country?: string | null;
  city?: string | null;
  metadata?: Record<string, unknown>;
}

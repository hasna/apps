import { getApiBaseUrl, getApiToken, loadConfig } from "./config.js";
import type { AddDomainInput, CreateLinkInput, Domain, Link, LinkStats } from "./types.js";

export interface ShortlinksApiClientOptions {
  baseUrl?: string;
  token?: string;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function requireBaseUrl(options: ShortlinksApiClientOptions): string {
  const baseUrl = options.baseUrl || getApiBaseUrl(loadConfig());
  if (!baseUrl) {
    throw new Error("Shortlinks API URL is not configured. Run `shortlinks config set api-url <url>` or set SHORTLINKS_API_URL.");
  }
  return normalizeBaseUrl(baseUrl);
}

function requireToken(options: ShortlinksApiClientOptions): string {
  const token = options.token || getApiToken(loadConfig());
  if (!token) {
    throw new Error("Shortlinks API token is not configured. Set SHORTLINKS_API_TOKEN or run `shortlinks config set api-token-env <name>`.");
  }
  return token;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: text };
    }
  }
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return parsed as T;
}

export class ShortlinksApiClient {
  constructor(private readonly options: ShortlinksApiClientOptions = {}) {}

  private url(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${requireBaseUrl(this.options)}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private headers(extra?: HeadersInit): HeadersInit {
    return {
      authorization: `Bearer ${requireToken(this.options)}`,
      ...(extra ?? {}),
    };
  }

  async totalStats(): Promise<{ domains: number; links: number; clicks: number }> {
    const response = await fetch(this.url("/stats"), { headers: this.headers() });
    return readJson(response);
  }

  async createLink(input: CreateLinkInput): Promise<Link> {
    const response = await fetch(this.url("/links"), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        destination_url: input.destinationUrl,
        domain: input.domain,
        slug: input.slug,
        title: input.title,
        expires_at: input.expiresAt,
        max_uses: input.maxUses,
        length: input.slugLength,
      }),
    });
    return readJson(response);
  }

  async listLinks(options: { domain?: string; activeOnly?: boolean; limit?: number } = {}): Promise<Link[]> {
    const response = await fetch(this.url("/links", {
      domain: options.domain,
      active: options.activeOnly,
      limit: options.limit,
    }), { headers: this.headers() });
    return readJson(response);
  }

  async getLink(domainOrSlug: string, maybeSlug?: string): Promise<Link | null> {
    const slug = maybeSlug ?? domainOrSlug;
    const response = await fetch(this.url(`/links/${encodeURIComponent(slug)}`, {
      domain: maybeSlug ? domainOrSlug : undefined,
    }), { headers: this.headers() });
    if (response.status === 404) return null;
    return readJson(response);
  }

  async setLinkActive(domainOrSlug: string, maybeSlugOrActive: string | boolean, maybeActive?: boolean): Promise<Link> {
    const hasDomain = typeof maybeSlugOrActive === "string";
    const slug = hasDomain ? maybeSlugOrActive : domainOrSlug;
    const active = hasDomain ? Boolean(maybeActive) : Boolean(maybeSlugOrActive);
    const response = await fetch(this.url(`/links/${encodeURIComponent(slug)}/active`, {
      domain: hasDomain ? domainOrSlug : undefined,
    }), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ active }),
    });
    return readJson(response);
  }

  async deleteLink(domainOrSlug: string, maybeSlug?: string): Promise<Link> {
    const slug = maybeSlug ?? domainOrSlug;
    const response = await fetch(this.url(`/links/${encodeURIComponent(slug)}`, {
      domain: maybeSlug ? domainOrSlug : undefined,
    }), {
      method: "DELETE",
      headers: this.headers(),
    });
    return readJson(response);
  }

  async getStats(domainOrSlug: string, maybeSlug?: string): Promise<LinkStats> {
    const slug = maybeSlug ?? domainOrSlug;
    const response = await fetch(this.url(`/stats/${encodeURIComponent(slug)}`, {
      domain: maybeSlug ? domainOrSlug : undefined,
    }), { headers: this.headers() });
    return readJson(response);
  }

  async addDomain(input: AddDomainInput): Promise<Domain> {
    const response = await fetch(this.url("/domains"), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        hostname: input.hostname,
        provider: input.provider,
        default_domain: input.defaultDomain,
        origin_url: input.originUrl,
        notes: input.notes,
      }),
    });
    return readJson(response);
  }

  async listDomains(): Promise<Domain[]> {
    const response = await fetch(this.url("/domains"), { headers: this.headers() });
    return readJson(response);
  }

  async getDomain(hostname: string): Promise<Domain | null> {
    const response = await fetch(this.url(`/domains/${encodeURIComponent(hostname)}`), { headers: this.headers() });
    if (response.status === 404) return null;
    return readJson(response);
  }

  async close(): Promise<void> {
    return undefined;
  }
}

/**
 * Cloudflare auth resolution for open-domains — supports BOTH a scoped API
 * token and a Global API Key + email (our vault stores the latter:
 * HASNAXYZ_CLOUDFLARE_LIVE_API_KEY / _EMAIL). Pure + testable.
 */

export interface CloudflareConfig {
  apiToken?: string;
  apiKey?: string;
  email?: string;
  accountId?: string;
}

export function resolveCloudflareConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): CloudflareConfig {
  const accountId =
    env["CLOUDFLARE_ACCOUNT_ID"] || env["HASNAXYZ_CLOUDFLARE_LIVE_ACCOUNT_ID"] || undefined;

  // 1. Scoped token (preferred).
  if (env["CLOUDFLARE_API_TOKEN"]) {
    return { apiToken: env["CLOUDFLARE_API_TOKEN"], accountId };
  }
  // 2. Global key + email (standard env).
  if (env["CLOUDFLARE_API_KEY"] && env["CLOUDFLARE_EMAIL"]) {
    return { apiKey: env["CLOUDFLARE_API_KEY"], email: env["CLOUDFLARE_EMAIL"], accountId };
  }
  // 3. Global key + email (HASNAXYZ vault names).
  if (env["HASNAXYZ_CLOUDFLARE_LIVE_API_KEY"] && env["HASNAXYZ_CLOUDFLARE_LIVE_EMAIL"]) {
    return {
      apiKey: env["HASNAXYZ_CLOUDFLARE_LIVE_API_KEY"],
      email: env["HASNAXYZ_CLOUDFLARE_LIVE_EMAIL"],
      accountId,
    };
  }
  return accountId ? { accountId } : {};
}

/** The auth headers to send for a given config. */
export function cloudflareAuthHeaders(cfg: CloudflareConfig): Record<string, string> {
  if (cfg.apiToken) return { Authorization: `Bearer ${cfg.apiToken}` };
  if (cfg.apiKey && cfg.email) return { "X-Auth-Key": cfg.apiKey, "X-Auth-Email": cfg.email };
  throw new Error(
    "Cloudflare credentials not configured. Set CLOUDFLARE_API_TOKEN, or CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL.",
  );
}

/**
 * Cloudflare auth resolution for open-domains. Supports a scoped API token
 * and a Global API Key + email. Pure + testable.
 */

import { CLOUDFLARE_ENV, firstEnv } from "./env-aliases.js";

export interface CloudflareConfig {
  apiToken?: string;
  apiKey?: string;
  email?: string;
  accountId?: string;
}

export function resolveCloudflareConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): CloudflareConfig {
  const accountId = firstEnv(env, CLOUDFLARE_ENV.accountId)?.value;
  const apiToken = firstEnv(env, CLOUDFLARE_ENV.apiToken)?.value;
  if (apiToken) return { apiToken, accountId };

  const apiKey = firstEnv(env, CLOUDFLARE_ENV.apiKey)?.value;
  const email = firstEnv(env, CLOUDFLARE_ENV.email)?.value;
  if (apiKey && email) return { apiKey, email, accountId };

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

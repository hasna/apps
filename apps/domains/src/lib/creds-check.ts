/**
 * Provisioning credential status — reports, per provider, whether usable
 * credentials are present (across all supported auth modes incl. HASNAXYZ vault
 * env names). Pure (env injected) + used by `domains doctor`.
 */

import { resolveCloudflareConfig } from "./cloudflare-auth.js";
import { resolveBrandsightConfig } from "./brandsight.js";

export interface CredStatus {
  provider: string;
  configured: boolean;
  mode: string;
  detail: string;
}

export function checkProvisioningCredentials(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): CredStatus[] {
  const out: CredStatus[] = [];

  // Route53 / AWS
  const hasAws = !!(env["AWS_ACCESS_KEY_ID"] && env["AWS_SECRET_ACCESS_KEY"]) || !!env["AWS_PROFILE"];
  out.push({
    provider: "route53",
    configured: hasAws,
    mode: env["AWS_PROFILE"] ? `profile:${env["AWS_PROFILE"]}` : hasAws ? "access-keys" : "none",
    detail: hasAws ? "AWS credentials present (region us-east-1 for Route53 Domains)" : "Set AWS_PROFILE or AWS_ACCESS_KEY_ID/SECRET",
  });

  // Cloudflare
  const cf = resolveCloudflareConfig(env);
  const cfMode = cf.apiToken ? "token" : cf.apiKey && cf.email ? "global-key" : "none";
  out.push({
    provider: "cloudflare",
    configured: cfMode !== "none",
    mode: cfMode + (cf.accountId ? "+account" : ""),
    detail: cfMode === "none" ? "Set CLOUDFLARE_API_TOKEN or CLOUDFLARE_API_KEY+CLOUDFLARE_EMAIL" : (cf.accountId ? "ok" : "missing CLOUDFLARE_ACCOUNT_ID (needed to create zones)"),
  });

  // Brandsight (gated)
  const bs = resolveBrandsightConfig(env);
  const bsConfigured = !!(bs.apiKey && bs.apiSecret && bs.customerId);
  out.push({
    provider: "brandsight",
    configured: bsConfigured,
    mode: bsConfigured ? "full-creds" : "none",
    detail: "enterprise/contract-only (gated) — not used for automated purchase",
  });

  // GoDaddy (gated)
  const gd = !!(env["GODADDY_API_KEY"] && env["GODADDY_API_SECRET"]);
  out.push({ provider: "godaddy", configured: gd, mode: gd ? "key+secret" : "none", detail: "retail API gated for purchase/DNS since 2024" });

  return out;
}

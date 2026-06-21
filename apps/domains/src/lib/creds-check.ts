/**
 * Provisioning credential status — reports, per provider, whether usable
 * credentials are present. Pure (env injected) + used by `domains doctor`.
 */

import { resolveCloudflareConfig } from "./cloudflare-auth.js";
import { brandsightCapability } from "./brandsight.js";
import { godaddyCapability } from "./godaddy.js";
import { sedoCapability } from "./sedo.js";
import { ROUTE53_ENV, firstEnv, hasProviderCredentials } from "./env-aliases.js";

export interface CredStatus {
  provider: string;
  configured: boolean;
  mode: string;
  detail: string;
}

function configuredStatus(provider: string, mode: string, detail: string): CredStatus {
  return { provider, configured: true, mode, detail };
}

function missingStatus(provider: string, detail: string): CredStatus {
  return { provider, configured: false, mode: "none", detail };
}

export function checkProvisioningCredentials(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): CredStatus[] {
  const out: CredStatus[] = [];

  // Route53 / AWS default credentials used by the live provider.
  const awsProfile = firstEnv(env, ROUTE53_ENV.profile);
  const awsAccessKey = firstEnv(env, ROUTE53_ENV.accessKeyId);
  const awsSecretKey = firstEnv(env, ROUTE53_ENV.secretAccessKey);
  const hasAwsKeys = !!(awsAccessKey && awsSecretKey);
  const hasWebIdentity = !!(
    firstEnv(env, ROUTE53_ENV.webIdentityTokenFile) &&
    firstEnv(env, ROUTE53_ENV.roleArn)
  );
  const hasContainerCredentials = !!firstEnv(env, ROUTE53_ENV.containerCredentials);
  if (awsProfile || hasAwsKeys || hasWebIdentity || hasContainerCredentials) {
    out.push(configuredStatus(
      "route53",
      awsProfile
        ? `profile:${awsProfile.value}`
        : hasAwsKeys
          ? "access-keys"
          : hasWebIdentity
            ? "web-identity"
            : "container-credentials",
      "AWS credentials present (Route 53 Domains API uses us-east-1)",
    ));
  } else {
    out.push(missingStatus(
      "route53",
      "Set ROUTE53_AWS_PROFILE/AWS_PROFILE, ROUTE53_ACCESS_KEY_ID+ROUTE53_SECRET_ACCESS_KEY, or AWS provider-chain credentials",
    ));
  }

  // Cloudflare.
  const cf = resolveCloudflareConfig(env);
  const cfMode = cf.apiToken ? "token" : cf.apiKey && cf.email ? "global-key" : "none";
  out.push({
    provider: "cloudflare",
    configured: cfMode !== "none",
    mode: cfMode + (cf.accountId ? "+account" : ""),
    detail: cfMode === "none"
      ? "Set CLOUDFLARE_API_TOKEN or CLOUDFLARE_API_KEY+CLOUDFLARE_EMAIL"
      : (cf.accountId ? "ok" : "missing CLOUDFLARE_ACCOUNT_ID (needed to create zones)"),
  });

  // Registrar / marketplace providers.
  out.push({
    provider: "namecheap",
    configured: hasProviderCredentials("namecheap", env),
    mode: hasProviderCredentials("namecheap", env) ? "api-key+username+client-ip" : "none",
    detail: "Requires NAMECHEAP_API_KEY, NAMECHEAP_USERNAME, and whitelisted NAMECHEAP_CLIENT_IP",
  });

  const gd = godaddyCapability(env);
  out.push({
    provider: "godaddy",
    configured: gd.configured,
    mode: gd.configured ? "key+secret" : "none",
    detail: gd.notes,
  });

  const bs = brandsightCapability(env);
  const bsMode = firstEnv(env, ["BRANDSIGHT_API_KEY"]) ? "standard-env" : "none";
  out.push({
    provider: "brandsight",
    configured: bs.configured,
    mode: bsMode,
    detail: bs.notes,
  });

  const sedo = sedoCapability(env);
  const sedoMode = firstEnv(env, ["SEDO_API_KEY"]) ? "standard-env" : "none";
  out.push({
    provider: "sedo",
    configured: sedo.configured,
    mode: sedoMode,
    detail: sedo.notes,
  });

  return out;
}

import type { ProviderCapabilityCard, ProviderId } from "../core/providers.ts";

export type ProviderScopeArea = "read" | "payments" | "cards" | "sensitiveCardData";

export interface ProviderEnvPreflight {
  readonly providerId: ProviderId;
  readonly allowedKeys: readonly string[];
  readonly rejectedKeys: readonly string[];
  readonly missingRequiredKeys: readonly string[];
}

export interface ProviderScopePreflight {
  readonly providerId: ProviderId;
  readonly area: ProviderScopeArea;
  readonly allowed: boolean;
  readonly requiredScopes: readonly string[];
  readonly grantedScopes: readonly string[];
  readonly missingScopes: readonly string[];
  readonly unsupportedReason?: string;
}

const PROVIDER_ENV_ALLOWLIST: Readonly<Record<ProviderId, readonly string[]>> = {
  mercury: ["MERCURY_API_TOKEN"],
  bunq: ["BUNQ_API_KEY", "BUNQ_DEVICE_ID", "BUNQ_PRIVATE_KEY"],
  "revolut-business": ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY", "REVOLUT_REFRESH_TOKEN"],
  "erste-bcr": ["ERSTE_CLIENT_ID", "ERSTE_CLIENT_SECRET", "ERSTE_REDIRECT_URI"],
};

const PROVIDER_REQUIRED_ENV: Readonly<Record<ProviderId, readonly string[]>> = {
  mercury: ["MERCURY_API_TOKEN"],
  bunq: ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"],
  "revolut-business": ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"],
  "erste-bcr": ["ERSTE_CLIENT_ID"],
};

export function providerEnvAllowlist(providerId: ProviderId): readonly string[] {
  return PROVIDER_ENV_ALLOWLIST[providerId];
}

export function preflightProviderEnv(providerId: ProviderId, env: Readonly<Record<string, string | undefined>>): ProviderEnvPreflight {
  const allowlist = new Set(PROVIDER_ENV_ALLOWLIST[providerId]);
  const allowedKeys: string[] = [];
  const rejectedKeys: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    if (!allowlist.has(key)) {
      rejectedKeys.push(key);
      continue;
    }
    if (typeof value === "string" && value.length > 0) {
      allowedKeys.push(key);
    }
  }

  const allowed = new Set(allowedKeys);
  const missingRequiredKeys = PROVIDER_REQUIRED_ENV[providerId].filter((key) => !allowed.has(key));
  return { providerId, allowedKeys, rejectedKeys, missingRequiredKeys };
}

export function preflightProviderScopes(
  provider: ProviderCapabilityCard,
  area: ProviderScopeArea,
  grantedScopes: readonly string[],
): ProviderScopePreflight {
  const requiredScopes = provider.scopes[area];
  const unsupportedReason = unsupportedScopeReason(provider, area);
  const granted = new Set(grantedScopes);
  const missingScopes = requiredScopes.filter((scope) => !granted.has(scope));
  return {
    providerId: provider.id,
    area,
    allowed: !unsupportedReason && requiredScopes.length > 0 && missingScopes.length === 0,
    requiredScopes,
    grantedScopes,
    missingScopes,
    ...(unsupportedReason ? { unsupportedReason } : {}),
  };
}

function unsupportedScopeReason(provider: ProviderCapabilityCard, area: ProviderScopeArea): string | undefined {
  if (area === "cards" && !provider.capabilities.cards) return "Provider does not support card scope operations.";
  if (area === "sensitiveCardData" && !provider.capabilities.sensitiveCardData) return "Provider does not support sensitive card data scope operations.";
  if (area === "payments" && !provider.capabilities.payments) return "Provider does not support payment scope operations.";
  if (area === "read" && !provider.capabilities.accounts && !provider.capabilities.transactions && !provider.capabilities.balances) {
    return "Provider does not support read scope operations.";
  }
  return undefined;
}

import { resolveEmailsHostedTransport } from "./emails-credentials.js";
import { loadEmailsClientEnvSecret } from "./client-env.js";

export interface ServerProviderHealth {
  provider_id: string;
  name: string;
  type: string;
  active: boolean;
  checked: boolean;
  status: "inactive" | "unconfigured" | "misconfigured" | "configured" | "unknown" | "restricted" | "healthy" | "unhealthy";
  message: string;
  credential_source?: string;
  region?: string;
  sendingEnabled?: boolean;
  productionAccessEnabled?: boolean;
}
export async function fetchProviderServerHealth(providerId: string, live = true, options: { baseUrl?: string; credentials?: string[]; fetchImpl?: typeof fetch } = {}): Promise<ServerProviderHealth> {
  let baseUrl = options.baseUrl;
  let credentials = options.credentials;
  if (!baseUrl || !credentials) {
    loadEmailsClientEnvSecret(process.env);
    const transport = resolveEmailsHostedTransport(process.env);
    baseUrl = transport.baseUrl;
    credentials = [transport.credential, ...(transport.credentialFallbacks ?? []).map((item) => item.value)];
  }
  const request = options.fetchImpl ?? fetch;
  for (let i = 0; i < credentials.length; i++) {
    const response = await request(`${baseUrl}/providers/${encodeURIComponent(providerId)}/health?live=${live}`, { headers: { Authorization: `Bearer ${credentials[i]}` }, signal: AbortSignal.timeout(12000), redirect: "error" });
    if (response.status === 401 && i < credentials.length - 1) continue;
    if (response.status === 404 || response.status === 405) throw new Error("The Emails API needs an update to support provider health, or this provider no longer exists in the tenant.");
    if (!response.ok) throw new Error(`Server provider health request failed (HTTP ${response.status}).`);
    const body = await response.json() as ServerProviderHealth;
    if (body.provider_id !== providerId || typeof body.checked !== "boolean" || typeof body.message !== "string" || !["inactive", "unconfigured", "misconfigured", "configured", "unknown", "restricted", "healthy", "unhealthy"].includes(body.status)) throw new Error("The Emails API needs an update: invalid provider health response.");
    return body;
  }
  throw new Error("No Emails API credential is configured.");
}
export async function listServerProviderIds(): Promise<string[]> {
  const { createConfiguredEmailStore } = await import("../store-resolution.js");
  const store = createConfiguredEmailStore();
  const providers: Array<{ id: string }> = [];
  const seen = new Set<string>();
  let complete = false;
  for (let page = 0; page < 100; page++) {
    const result = await store.providers.list({ limit: 500, offset: providers.length });
    if (!result.ok) throw new Error("The provider registry could not be enumerated for server health checks.");
    if (!result.value.length) { complete = true; break; }
    for (const row of result.value) {
      const id = String(row.id ?? "");
      if (!id || seen.has(id)) throw new Error("Provider registry changed during enumeration; retry the health check.");
      seen.add(id);
      providers.push({ id });
    }
  }
  if (!complete) throw new Error("Provider registry enumeration was incomplete; no complete health report is available.");
  return providers.map(provider => provider.id);
}
export async function listServerProviderHealth(live = true): Promise<ServerProviderHealth[]> {
  const providers = await listServerProviderIds();
  const results: ServerProviderHealth[] = [];
  for (let offset = 0; offset < providers.length; offset += 8) {
    results.push(...await Promise.all(providers.slice(offset, offset + 8).map((provider) => fetchProviderServerHealth(provider, live))));
  }
  return results;
}
export function formatServerProviderHealth(result: ServerProviderHealth): string {
  return `${result.name} (${result.type}): ${result.status}\n  ${result.message}${result.credential_source ? `\n  Credential source: ${result.credential_source}` : ""}${result.productionAccessEnabled === false ? "\n  SES account is in sandbox." : ""}`;
}

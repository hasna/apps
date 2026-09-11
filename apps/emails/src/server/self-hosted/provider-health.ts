import type { TenantScopedStore } from "./store.js";
import { resourceSpecForPath } from "./resources.js";
import type { SenderResolver } from "./sender.js";

export async function readProviderHealth(store: TenantScopedStore, tenantId: string, providerId: string, live: boolean, resolveSender?: SenderResolver, timeoutMs = 5000) {
  const provider = await store.getResource(resourceSpecForPath("providers")!, providerId);
  if (!provider) return null;
  const base = { provider_id: providerId, name: String(provider.name ?? providerId), type: String(provider.type), active: provider.active !== false, checked: false };
  if (provider.active === false) return { ...base, status: "inactive", message: "Provider is inactive." };
  const sender = await resolveSender?.(tenantId, providerId);
  if (!sender) return { ...base, status: "unconfigured", message: "Configure EMAILS_SENDER_BINDINGS for this tenant/provider on the server." };
  if (sender.provider !== provider.type) return { ...base, status: "misconfigured", message: "Provider type does not match its server binding." };
  const bound = { ...base, credential_source: sender.credentialSource ?? "server_binding", ...(sender.region ? { region: sender.region } : {}) };
  if (!live) return { ...bound, status: "configured", message: "Server binding exists; credentials have not been probed." };
  if (!sender.probe) return { ...bound, status: "unknown", message: "This server binding does not implement a credential probe." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const details = await Promise.race([
      sender.probe(controller.signal),
      new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true })),
    ]);
    return { ...bound, checked: true, status: details.sendingEnabled === false ? "restricted" : "healthy", message: details.sendingEnabled === false ? "Provider credentials work, but account sending is disabled." : "Server credentials passed a read-only provider API probe.", ...details };
  } catch {
    return { ...bound, checked: true, status: "unhealthy", message: controller.signal.aborted ? "Server provider probe timed out." : "Server provider probe failed. Check its credential binding, permissions, and provider availability." };
  } finally { clearTimeout(timer); }
}

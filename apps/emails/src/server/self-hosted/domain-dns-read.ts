import type { TenantScopedStore } from "./store.js";
import type { SenderResolver } from "./sender.js";
import { resourceSpecForPath } from "./resources.js";
import { validateConnectionEvidence } from "./domain-connect.js";
import { generateDmarcRecord } from "../../lib/dns.js";

export class DomainDnsReadError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function readDomainDnsRecords(store: TenantScopedStore, tenant: string, id: string, providerId: string | undefined, resolveSender?: SenderResolver, parent?: AbortSignal, timeoutMs = 30000) {
  const domain = await store.getDomain(id);
  if (!domain) throw new DomainDnsReadError("Domain not found in this account", 404);
  if (providerId !== undefined && (!providerId.trim() || providerId !== domain.provider)) throw new DomainDnsReadError("The selected provider does not match the registered domain", 409);
  if (!domain.provider) throw new DomainDnsReadError("Domain has no registered provider", 409);
  const spec = resourceSpecForPath("providers")!;
  const provider = await store.getResource(spec, domain.provider);
  if (!provider || !["ses", "resend"].includes(String(provider.type))) throw new DomainDnsReadError("Domain provider is unavailable or does not publish DNS records", 409);
  let sender;
  try { sender = await resolveSender?.(tenant, domain.provider); } catch { throw new DomainDnsReadError("Server provider binding could not be resolved", 503); }
  if (!sender?.readDomainConnection || sender.provider !== provider.type) throw new DomainDnsReadError("A matching server provider binding with DNS-read capability is required", 503);
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(parent ? [parent] : [])]);
  let evidence;
  let abort: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(new Error("DNS read interrupted"));
      signal.addEventListener("abort", abort, { once: true });
    });
    evidence = await Promise.race([interrupted, sender.readDomainConnection(domain.domain, signal)]);
    validateConnectionEvidence(evidence);
  }
  catch { throw new DomainDnsReadError("The bound provider could not return valid DNS records; retry or review server provider configuration", 502); }
  finally { if (abort) signal.removeEventListener("abort", abort); }
  const current = await store.getDomain(id);
  const currentProvider = await store.getResource(spec, domain.provider);
  if (!current || current.domain !== domain.domain || current.provider !== domain.provider || !currentProvider || currentProvider.type !== provider.type) throw new DomainDnsReadError("Domain provider binding changed while reading DNS records; retry", 409);
  if (!evidence.registered) throw new DomainDnsReadError("Domain is not registered with the bound provider", 409);
  return { domain: domain.domain, domain_id: domain.id, provider_id: domain.provider, source: "live_provider" as const,
    verified_for_sending: evidence.verified_for_sending, checked_at: new Date().toISOString(),
    records: [...evidence.dns_tasks, generateDmarcRecord(domain.domain)] };
}

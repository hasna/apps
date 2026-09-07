import { resolveMx } from "node:dns/promises";
import { resourceSpecForPath } from "./resources.js";
import type { TenantScopedStore } from "./store.js";
import type { SenderResolver } from "./sender.js";

export type DomainOperation = "verify" | "enable-outbound" | "disable-outbound" | "enable-inbound";
export class DomainOperationError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export async function runDomainOperation(
  store: TenantScopedStore,
  tenantId: string,
  ref: string,
  operation: DomainOperation,
  options: { providerId?: string; resolveSender?: SenderResolver; env?: NodeJS.ProcessEnv; mx?: typeof resolveMx } = {},
) {
  const domain = await store.getDomain(ref) ?? await store.getDomainByName(ref);
  if (!domain) throw new DomainOperationError("Domain not found in this tenant.", 404);
  if (operation === "disable-outbound") {
    const updated = await store.updateDomain(domain.id, { status: "outbound_disabled" });
    return { domain: updated, outbound_enabled: false };
  }
  const providerId = options.providerId ?? domain.provider ?? undefined;
  if (!providerId) throw new DomainOperationError("Choose --provider and bind that tenant provider on the server.", 400);
  const provider = await store.getResource(resourceSpecForPath("providers")!, providerId);
  if (!provider) throw new DomainOperationError("Provider not found in this tenant.", 404);
  if (provider.active === false) throw new DomainOperationError("The domain provider is inactive.");
  const sender = options.resolveSender?.(tenantId, providerId);
  if (!sender?.verifyDomain) throw new DomainOperationError("Configure EMAILS_SENDER_BINDINGS for this tenant/provider so the server can verify its domain.", 503);
  if (provider.type !== sender.provider) throw new DomainOperationError("Provider type does not match its server binding.");
  const dns = await sender.verifyDomain(domain.domain);
  const verified = dns.verifiedForSending ?? (dns.dkim === "verified" && dns.spf === "verified");
  if (operation !== "verify" && !verified) throw new DomainOperationError("The provider has not verified this domain for sending. Publish its required DNS records, then run domain verify.");
  let inbound: { ready: boolean; reason: string } | undefined;
  if (operation === "enable-inbound") {
    const env = options.env ?? process.env;
    const bucket = env.EMAILS_INGEST_S3_BUCKET?.trim();
    if (!bucket || !env.EMAILS_INGEST_QUEUE_URL?.trim()) throw new DomainOperationError("Configure the server ingest S3 bucket and queue before enabling inbound mail.", 503);
    if (!sender.checkInboundDomain || !sender.region) throw new DomainOperationError("This provider binding cannot verify an SES inbound receipt route.", 503);
    const mx = await (options.mx ?? resolveMx)(domain.domain);
    const expected = `inbound-smtp.${sender.region}.amazonaws.com`;
    if (!mx.some((entry) => entry.exchange.toLowerCase().replace(/\.$/, "") === expected)) {
      throw new DomainOperationError(`The published MX does not route this domain to ${expected}. Configure routing explicitly; this command does not change DNS.`);
    }
    inbound = await sender.checkInboundDomain(domain.domain, bucket);
    if (!inbound.ready) throw new DomainOperationError(inbound.reason);
  }
  let updated = await store.updateDomain(domain.id, {
    verified,
    ...(options.providerId ? { provider: providerId } : {}),
    ...(operation === "enable-outbound" ? { status: "active" } : {}),
  });
  if (operation === "enable-outbound") updated = await store.applyDomainProvisioning(domain.id, { provisioning_status: "verified", last_error: null });
  if (operation === "enable-inbound" && !["ready", "active", "verified"].includes(domain.provisioning_status ?? "")) {
    updated = await store.applyDomainProvisioning(domain.id, { provisioning_status: "inbound_ready", last_error: null });
  }
  return { domain: updated, dns, ...(inbound ? { inbound } : {}), ...(operation === "enable-outbound" ? { outbound_enabled: true } : {}) };
}

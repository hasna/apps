import { getProvider } from "../db/providers.js";
import { createDomain, getDomainByName, listDomains } from "../db/domains.js";
import { resolveId } from "../cli/utils.js";
import { listRegisteredS3Sources, type RegisteredS3Source } from "./inbox-source-registry.js";
import { connectDomain } from "./domain-connect-api.js";
import { setupSesInboundApi } from "./ses-inbound-setup-api.js";
import { syncS3InboxApi } from "./inbox-ingest-api.js";
import { createCatchAll, ensureDefaultCatchAll } from "../db/aliases.js";

export interface SharedInboundOptions { bucket?: string; region?: string; prefix?: string; provider?: string; profile?: string; catchAll?: boolean }
export async function selectSharedInboundSource(domain: string, options: SharedInboundOptions): Promise<RegisteredS3Source> {
  for (const key of ["bucket", "region", "prefix", "provider"] as const) if (options[key] !== undefined && !options[key]!.trim()) throw new Error(`${key} must not be blank.`);
  if (options.profile !== undefined) throw new Error("AWS profiles are server-owned; configure the account ingest binding. No setup was submitted.");
  if (options.catchAll) throw new Error("Subdomain catch-all requires separately authorized domain routes. No setup was submitted.");
  const provider = options.provider !== undefined ? resolveId("providers", options.provider) : undefined;
  let sources = (await listRegisteredS3Sources()).filter(source => source.status === "live" && (!provider || !source.provider_id || source.provider_id === provider) && (options.bucket === undefined || source.bucket === options.bucket) && (options.region === undefined || source.region === options.region) && (options.prefix === undefined || source.prefix === options.prefix));
  if (options.prefix === undefined) {
    const matchingDomain = sources.filter(source => source.prefix === `inbound/${domain.toLowerCase()}/`);
    if (matchingDomain.length) sources = matchingDomain;
  }
  if (sources.length !== 1) throw new Error(sources.length ? "Multiple account sources match; choose --bucket and --prefix where supported." : "No active account S3 source matches. Register the source and configure its server ingest binding before setup.");
  return sources[0]!;
}
export async function setupSharedInbound(domain: string, options: SharedInboundOptions) {
  const source = await selectSharedInboundSource(domain, options);
  const receipt = await setupSesInboundApi({ domain, bucket: source.bucket, region: source.region, ...(source.prefix !== undefined ? { prefix: source.prefix } : {}), ...(options.catchAll !== undefined ? { catch_all: options.catchAll } : {}) });
  return { ...receipt, source_of_truth: "postgres" as const };
}
export interface RegisterSharedDomainOptions { provider: string; dryRun?: boolean; sendOnly?: boolean; domainType?: string; bucket?: string; region?: string; catchAll?: string; sync?: boolean; forceMxSwitch?: boolean; adopt?: boolean }
export async function registerSharedDomain(domain: string, options: RegisterSharedDomainOptions) {
  if (options.domainType !== undefined && options.domainType !== "self_hosted") throw new Error("Account domains use the shared server registry; --domain-type supports self_hosted only. No setup was submitted.");
  if (options.sendOnly && (options.bucket !== undefined || options.region !== undefined || options.sync || options.forceMxSwitch)) throw new Error("Inbound options cannot be combined with --send-only/--no-inbound.");
  if (options.forceMxSwitch) throw new Error("This command does not switch DNS ownership. Use domain setup-cloudflare --add-mx --force-mx-switch for that explicit operation.");
  if (options.catchAll !== undefined && (!options.catchAll.trim() || !/^[^\s@]+@[^\s@]+$/.test(options.catchAll))) throw new Error("Catch-all target must be an email address.");
  const providerId = resolveId("providers", options.provider), provider = getProvider(providerId);
  if (!provider) throw new Error("Provider not found in this account.");
  if (!provider.active) throw new Error("Select an active account provider before setup.");
  const source = options.sendOnly ? undefined : await selectSharedInboundSource(domain, { provider: providerId, bucket: options.bucket, region: options.region });
  if (source && provider.type !== "ses") throw new Error("Bound S3 inbound setup requires an SES provider. Use --send-only/--no-inbound for other providers and configure their authenticated webhook ingress separately.");
  if (options.dryRun) return { ok: true, dry_run: true, domain, provider_id: providerId, source_of_truth: "postgres", would_call_provider: provider.type !== "sandbox", would_create_domain: !listDomains().some(row => row.domain === domain && row.provider_id === providerId), inbound_chain: source ? { planned: true, source_id: source.id, bucket: source.bucket, prefix: source.prefix, region: source.region, server_binding_checked: false } : { planned: false, reason: "send-only requested" } };
  let result: Record<string, unknown>;
  if (provider.type === "sandbox") {
    const registered = getDomainByName(providerId, domain) ?? createDomain(providerId, domain);
    result = { ok: true, source_of_truth: "postgres", domain, provider_id: providerId, domain_record: registered, registration_only: true, provider_contacted: false, receiving_configured: false };
  } else {
    const connection = await connectDomain(domain, { provider: providerId, registerProvider: true });
    result = { ok: ["verified", "pending_verification"].includes(connection.connection.status) && connection.connection.provider_registered === true, source_of_truth: "postgres", domain, provider_id: providerId, connection: connection.connection };
  }
  if (!result.ok) return result;
  try {
  if (source) {
    const inbound = await setupSesInboundApi({ domain, bucket: source.bucket, region: source.region, ...(source.prefix !== undefined ? { prefix: source.prefix } : {}) });
    result.inbound = inbound; result.ok = inbound.ok && inbound.verified;
    if (!result.ok) return result;
  }
  if (options.adopt) {
    await ensureDefaultCatchAll();
    if (options.catchAll) result.catch_all = await createCatchAll(domain, options.catchAll);
  }
  if (options.sync && source) {
    const sync = await syncS3InboxApi({ bucket: source.bucket, source_id: source.id, prefix: source.prefix, region: source.region, provider_id: providerId, limit: 500 });
    result.sync = sync; result.ok = sync.ok;
  }
  } catch (error) { result.ok = false; result.error = error instanceof Error ? error.message : "A later setup step failed; inspect the retained connection receipt before retrying."; }
  return result;
}
export async function sharedInboundStatus(options: { domain?: string; bucket?: string; region?: string; profile?: string } = {}) {
  if (options.profile !== undefined) throw new Error("AWS profiles are server-owned. This command reads account registry evidence.");
  for (const key of ["domain", "bucket", "region"] as const) if (options[key] !== undefined && !options[key]!.trim()) throw new Error(`${key} must not be blank.`);
  const registered = listDomains().filter(row => !options.domain || row.domain.toLowerCase() === options.domain.toLowerCase());
  if (options.domain && !registered.length) throw new Error("Domain not found in this account.");
  const sources = (await listRegisteredS3Sources()).filter(source => (!options.bucket || source.bucket === options.bucket) && (!options.region || source.region === options.region));
  return { source_of_truth: "postgres", evidence: "account_registry", checked_at: new Date().toISOString(), sources, reports: registered.map(domain => ({ domain: domain.domain, provider_id: domain.provider_id, inbound_status: domain.inbound_status, outbound_status: domain.outbound_status, last_inbound_check_at: domain.last_inbound_check_at ?? null, receiving_ready: null, live_receipt_rules: "unknown", message: "Registry state is observed; current AWS receipt-rule and end-to-end delivery readiness were not probed." })), active_rule_set: null, live_aws_status: "unknown" };
}

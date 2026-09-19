import { createDomainsClientFromEnv, type DomainProvisioningJob } from "@hasna/domains/sdk";
import type { Domain } from "./types.js";

/**
 * Narrow client seam for the hosted Domains API. Shortlinks sends business
 * intent plus the `shortlinks` target profile; registrar, DNS provider,
 * nameservers, Cloudflare zone, and Worker binding choices stay in Domains.
 */
export interface DomainsProvisioningClient {
  requestDomainProvisioning(
    body: {
      name: string;
      max_price_usd: number;
      years: number;
      auto_renew: boolean;
      target?: "shortlinks";
    },
    init?: RequestInit,
  ): Promise<DomainProvisioningJob>;
  getDomainProvisioning(id: string, init?: RequestInit): Promise<DomainProvisioningJob>;
  checkDomainAvailability(body: { name: string }, init?: RequestInit): Promise<{
    name: string;
    available: boolean;
    price_usd?: number;
    currency?: string;
    is_premium?: boolean;
  }>;
}

export interface DomainProjectionStore {
  addDomain(input: {
    hostname: string;
    provider?: string;
    defaultDomain?: boolean;
    originUrl?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Domain>;
  listDomains(): Promise<Domain[]>;
}

export interface ShortlinksDomainProvisioning {
  id: string;
  name: string;
  status: DomainProvisioningJob["status"];
  error: string | null;
  created_at: string;
  updated_at: string;
}

export function projectDomainProvisioning(job: DomainProvisioningJob): ShortlinksDomainProvisioning {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    error: job.error ?? null,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

export function createDomainsProvisioningClient(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): DomainsProvisioningClient {
  // Delegate credential and authority resolution to the public Domains SDK.
  // This preserves the shared @hasna/contracts chain (argument/pointer,
  // Keychain, credentials file, then env) and refreshes rotated credentials
  // per request instead of snapshotting another service's key in Shortlinks.
  return createDomainsClientFromEnv(env, { fetch: fetchImpl });
}

export interface RequestShortlinksDomainInput {
  hostname: string;
  maxPriceUsd: number;
  years: number;
  autoRenew: boolean;
  idempotencyKey: string;
}

export async function requestShortlinksDomain(
  client: DomainsProvisioningClient,
  input: RequestShortlinksDomainInput,
): Promise<DomainProvisioningJob> {
  return client.requestDomainProvisioning(
    {
      name: input.hostname,
      max_price_usd: input.maxPriceUsd,
      years: input.years,
      auto_renew: input.autoRenew,
      target: "shortlinks",
    },
    { headers: { "idempotency-key": input.idempotencyKey } },
  );
}

function localStatus(job: DomainProvisioningJob): "pending" | "active" | "failed" {
  if (job.status === "ready") return "active";
  if (job.status === "failed" || job.status === "manual_review") return "failed";
  return "pending";
}

export function domainProvisioningMetadata(
  job: DomainProvisioningJob,
  requestedDefault: boolean,
): Record<string, unknown> {
  return {
    provisioning: {
      status: localStatus(job),
      mode: "domains-api",
      domains_job_id: job.id,
      domains_status: job.status,
      requested_default: requestedDefault,
      updated_at: new Date().toISOString(),
      ...(job.error ? { error: job.error } : {}),
    },
  };
}

export function domainProvisioningJobId(domain: Domain): string | null {
  const provisioning = domain.metadata?.["provisioning"];
  if (!provisioning || typeof provisioning !== "object" || Array.isArray(provisioning)) return null;
  const id = (provisioning as Record<string, unknown>)["domains_job_id"];
  return typeof id === "string" && id ? id : null;
}

export async function readShortlinksDomainProvisioning(
  client: DomainsProvisioningClient,
  domain: Domain,
): Promise<ShortlinksDomainProvisioning> {
  const jobId = domainProvisioningJobId(domain);
  if (!jobId) throw new Error("Domain has no Domains API provisioning job.");
  return projectDomainProvisioning(await client.getDomainProvisioning(jobId));
}

export async function reconcileShortlinksDomain(
  store: DomainProjectionStore,
  client: DomainsProvisioningClient,
  domain: Domain,
): Promise<{ domain: Domain; provisioning: ShortlinksDomainProvisioning }> {
  const jobId = domainProvisioningJobId(domain);
  if (!jobId) throw new Error("Domain has no Domains API provisioning job.");
  const job = await client.getDomainProvisioning(jobId);
  const prior = domain.metadata?.["provisioning"];
  const requestedDefault = Boolean(
    prior && typeof prior === "object" && !Array.isArray(prior)
      ? (prior as Record<string, unknown>)["requested_default"]
      : false,
  );
  const updated = await store.addDomain({
    hostname: domain.hostname,
    provider: "domains-api",
    defaultDomain: job.status === "ready" ? requestedDefault : false,
    notes: "Provisioned exclusively by the configured Domains API.",
    metadata: domainProvisioningMetadata(job, requestedDefault),
  });
  return { domain: updated, provisioning: projectDomainProvisioning(job) };
}

export async function reconcilePendingShortlinksDomains(
  store: DomainProjectionStore,
  client: DomainsProvisioningClient,
): Promise<{ checked: number; activated: number; failed: number; errors: number }> {
  const domains = await store.listDomains();
  let checked = 0;
  let activated = 0;
  let failed = 0;
  let errors = 0;
  for (const domain of domains) {
    const jobId = domainProvisioningJobId(domain);
    if (!jobId) continue;
    const provisioning = domain.metadata?.["provisioning"] as Record<string, unknown> | undefined;
    if (provisioning?.["status"] === "active" || provisioning?.["status"] === "failed") continue;
    checked++;
    try {
      const result = await reconcileShortlinksDomain(store, client, domain);
      const status = (result.domain.metadata?.["provisioning"] as Record<string, unknown> | undefined)?.["status"];
      if (status === "active") activated++;
      if (status === "failed") failed++;
    } catch {
      errors++;
    }
  }
  return { checked, activated, failed, errors };
}

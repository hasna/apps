import { createHash, randomUUID } from "node:crypto";
import { normalizeDomainName } from "../db/dns-tools.js";

export const PROVISIONING_STATUSES = [
  "requested",
  "quoted",
  "registration_submitting",
  "registration_submitted",
  "registered",
  "zone_ready",
  "nameservers_submitted",
  "delegated",
  "worker_bound",
  "ready",
  "manual_review",
  "failed",
] as const;

export type ProvisioningStatus = (typeof PROVISIONING_STATUSES)[number];

export interface DomainProvisioningRequest {
  name: string;
  idempotency_key: string;
  max_price_usd: number;
  years: number;
  auto_renew: boolean;
  registrar: "route53";
  dns_provider: "cloudflare";
  target: "shortlinks";
  worker_name: string;
}

export interface DomainProvisioningProviderState {
  quoted_price_usd?: number;
  currency?: string;
  registration_operation_id?: string;
  nameserver_operation_id?: string;
  cloudflare_zone_id?: string;
  cloudflare_nameservers?: string[];
  route53_zone_ids_before_registration?: string[];
  route53_hosted_zone_id?: string;
  route53_hosted_zone_cleaned?: boolean;
  worker_domain_bound?: boolean;
  last_provider_status?: string;
  registration_submitted_at?: string;
  nameservers_submitted_at?: string;
}

export interface DomainProvisioningJob extends DomainProvisioningRequest {
  id: string;
  domain_id: string;
  request_hash: string;
  status: ProvisioningStatus;
  provider_state: DomainProvisioningProviderState;
  attempts: number;
  error: string | null;
  lease_token: string | null;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface DomainProvisioningStore {
  reserve(request: DomainProvisioningRequest, requestHash: string): Promise<DomainProvisioningJob>;
  get(id: string): Promise<DomainProvisioningJob | null>;
  listRunnable(limit: number): Promise<DomainProvisioningJob[]>;
  claim(id: string, leaseToken: string, leaseUntil: string): Promise<DomainProvisioningJob | null>;
  update(
    id: string,
    patch: Partial<Pick<DomainProvisioningJob, "status" | "provider_state" | "attempts" | "error" | "lease_token" | "lease_until">>,
    leaseToken?: string,
  ): Promise<DomainProvisioningJob | null>;
  markPortfolioReady(job: DomainProvisioningJob, detail: RegisteredDomainDetail): Promise<void>;
}

export interface AvailabilityQuote {
  available: boolean;
  price_usd?: number;
  currency?: string;
  is_premium?: boolean;
}

export interface ProviderOperationStatus {
  status: string;
  message?: string;
}

export interface RegisteredDomainDetail {
  registered_at?: string;
  expires_at?: string;
  auto_renew?: boolean;
  nameservers: string[];
  registrar?: string;
}

export interface CloudflareZoneState {
  id: string;
  status: string;
  nameservers: string[];
}

export interface DomainProvisioningProviders {
  checkAvailability(name: string): Promise<AvailabilityQuote>;
  submitRegistration(input: {
    name: string;
    years: number;
    autoRenew: boolean;
  }): Promise<{ operationId: string }>;
  getOperationStatus(operationId: string): Promise<ProviderOperationStatus>;
  getDomainDetail(name: string): Promise<RegisteredDomainDetail | null>;
  ensureCloudflareZone(name: string): Promise<CloudflareZoneState>;
  updateNameservers(name: string, nameservers: string[]): Promise<{ operationId: string }>;
  resolvePublicNameservers(name: string): Promise<string[]>;
  bindWorkerDomain(input: { hostname: string; zoneId: string; workerName: string }): Promise<void>;
  workerDomainReady(input: { hostname: string; zoneId: string; workerName: string }): Promise<boolean>;
  listRoute53HostedZoneIds?(name: string): Promise<string[]>;
  cleanupRoute53HostedZone?(input: {
    name: string;
    hostedZoneId: string;
    registrarNameservers: string[];
  }): Promise<boolean>;
}

export interface ProvisioningWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
  leaseMs?: number;
  maxAttempts?: number;
  now?: () => Date;
  log?: (event: string, detail: Record<string, unknown>) => void;
}

const TERMINAL = new Set<ProvisioningStatus>(["ready", "manual_review", "failed"]);

function requestHash(request: DomainProvisioningRequest): string {
  return createHash("sha256").update(JSON.stringify({
    auto_renew: request.auto_renew,
    dns_provider: request.dns_provider,
    max_price_usd: request.max_price_usd,
    name: request.name,
    registrar: request.registrar,
    target: request.target,
    worker_name: request.worker_name,
    years: request.years,
  })).digest("hex");
}

function normalizeRequest(input: Partial<DomainProvisioningRequest>): DomainProvisioningRequest {
  const name = normalizeDomainName(String(input.name ?? ""));
  const idempotencyKey = String(input.idempotency_key ?? "").trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new Error("idempotency_key must be 8-128 safe characters");
  }
  const maxPrice = Number(input.max_price_usd);
  if (!Number.isFinite(maxPrice) || maxPrice <= 0 || maxPrice > 1000) {
    throw new Error("max_price_usd must be greater than 0 and at most 1000");
  }
  const years = Number(input.years ?? 1);
  if (!Number.isInteger(years) || years < 1 || years > 10) {
    throw new Error("years must be an integer from 1 to 10");
  }
  if (typeof input.auto_renew !== "boolean") {
    throw new Error("auto_renew must be explicitly true or false");
  }
  const registrar = input.registrar ?? "route53";
  const dnsProvider = input.dns_provider ?? "cloudflare";
  const target = input.target ?? "shortlinks";
  const workerName = String(input.worker_name ?? "hasna-link-router").trim();
  if (registrar !== "route53") throw new Error("only registrar=route53 is supported by hosted provisioning");
  if (dnsProvider !== "cloudflare") throw new Error("only dns_provider=cloudflare is supported by hosted provisioning");
  if (target !== "shortlinks") throw new Error("only target=shortlinks is supported by hosted provisioning");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(workerName)) throw new Error("invalid worker_name");
  return {
    name,
    idempotency_key: idempotencyKey,
    max_price_usd: maxPrice,
    years,
    auto_renew: input.auto_renew,
    registrar,
    dns_provider: dnsProvider,
    target,
    worker_name: workerName,
  };
}

function normalizeNameservers(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean))].sort();
}

function nameserversEqual(left: string[], right: string[]): boolean {
  return JSON.stringify(normalizeNameservers(left)) === JSON.stringify(normalizeNameservers(right));
}

function operationVerdict(status: string): "pending" | "success" | "failed" {
  const normalized = status.toUpperCase();
  if (normalized === "SUCCESSFUL") return "success";
  if (normalized === "ERROR" || normalized === "FAILED") return "failed";
  return "pending";
}

function boundedPurchaseQuote(
  quote: AvailabilityQuote,
  request: Pick<DomainProvisioningRequest, "max_price_usd" | "years">,
): { totalPriceUsd: number; currency: "USD" } | { error: string } {
  if (!quote.available) return { error: "domain is not available" };
  if (!Number.isFinite(quote.price_usd)) return { error: "registrar returned no bounded purchase price" };
  const currency = (quote.currency ?? "USD").toUpperCase();
  if (currency !== "USD") return { error: `registrar returned unsupported currency ${currency}` };
  const totalPriceUsd = Number((quote.price_usd! * request.years).toFixed(2));
  if (totalPriceUsd > request.max_price_usd) {
    return { error: `quoted total price exceeds max_price_usd (${totalPriceUsd} > ${request.max_price_usd})` };
  }
  return { totalPriceUsd, currency: "USD" };
}

function positiveIntegerOption(name: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return resolved;
}

export class DomainProvisioningService {
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => Date;
  private readonly log: (event: string, detail: Record<string, unknown>) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scheduledRunActive = false;

  constructor(
    private readonly store: DomainProvisioningStore,
    private readonly providers: DomainProvisioningProviders,
    options: ProvisioningWorkerOptions = {},
  ) {
    this.intervalMs = positiveIntegerOption("intervalMs", options.intervalMs, 5_000);
    this.batchSize = positiveIntegerOption("batchSize", options.batchSize, 5);
    this.leaseMs = positiveIntegerOption("leaseMs", options.leaseMs, 60_000);
    // Polling successful but externally pending provider states is normal and
    // may last hours (registrar operations, NS propagation, certificate issue).
    // Keep the default bounded, but large enough for two active workers at the
    // default cadence; transitions reset the per-state counter below.
    this.maxAttempts = positiveIntegerOption("maxAttempts", options.maxAttempts, 17_280);
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => {});
  }

  async quote(name: string): Promise<{ name: string } & AvailabilityQuote> {
    const normalized = normalizeDomainName(name);
    const quote = await this.providers.checkAvailability(normalized);
    return { name: normalized, ...quote };
  }

  async request(input: Partial<DomainProvisioningRequest>): Promise<DomainProvisioningJob> {
    const normalized = normalizeRequest(input);
    return this.store.reserve(normalized, requestHash(normalized));
  }

  get(id: string): Promise<DomainProvisioningJob | null> {
    return this.store.get(id);
  }

  async advance(id: string): Promise<DomainProvisioningJob> {
    const leaseToken = randomUUID();
    const leaseUntil = new Date(this.now().getTime() + this.leaseMs).toISOString();
    const claimed = await this.store.claim(id, leaseToken, leaseUntil);
    if (!claimed) {
      const current = await this.store.get(id);
      if (!current) throw new Error("provisioning job not found");
      return current;
    }

    try {
      if (TERMINAL.has(claimed.status)) return claimed;
      if (claimed.attempts >= this.maxAttempts) {
        return (await this.store.update(claimed.id, {
          status: "failed",
          attempts: claimed.attempts + 1,
          error: "provisioning attempt limit exceeded",
          lease_token: null,
          lease_until: null,
        }, leaseToken))!;
      }
      const advanced = await this.advanceClaimed(claimed, leaseToken);
      this.log("domain_provisioning_advanced", {
        id: advanced.id,
        name: advanced.name,
        status: advanced.status,
        attempts: advanced.attempts,
      });
      return advanced;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const ambiguous = claimed.status === "registration_submitting";
      const status: ProvisioningStatus = ambiguous ? "manual_review" : claimed.status;
      const updated = await this.store.update(claimed.id, {
        status,
        attempts: claimed.attempts + 1,
        error: message.slice(0, 1000),
        lease_token: null,
        lease_until: null,
      }, leaseToken);
      this.log("domain_provisioning_error", {
        id: claimed.id,
        name: claimed.name,
        status,
        error: message.slice(0, 300),
      });
      return updated ?? claimed;
    }
  }

  private async advanceClaimed(job: DomainProvisioningJob, leaseToken: string): Promise<DomainProvisioningJob> {
    const nextAttempts = job.attempts + 1;
    const clearLease = { lease_token: null, lease_until: null } as const;
    const update = async (
      patch: Partial<Pick<DomainProvisioningJob, "status" | "provider_state" | "attempts" | "error" | "lease_token" | "lease_until">>,
    ) => {
      const transitioned = patch.status !== undefined && patch.status !== job.status;
      const attempts = patch.attempts ?? (transitioned ? 0 : nextAttempts);
      return (await this.store.update(job.id, { attempts, error: null, ...patch }, leaseToken))!;
    };

    switch (job.status) {
      case "requested": {
        const quote = boundedPurchaseQuote(await this.providers.checkAvailability(job.name), job);
        if ("error" in quote) return update({ status: "failed", error: quote.error, ...clearLease });
        return update({
          status: "quoted",
          provider_state: { ...job.provider_state, quoted_price_usd: quote.totalPriceUsd, currency: quote.currency },
          ...clearLease,
        });
      }
      case "quoted": {
        // Recheck availability and the total multi-year charge immediately
        // before recording purchase intent. A stale earlier quote can never
        // authorize a higher registrar charge.
        const quote = boundedPurchaseQuote(await this.providers.checkAvailability(job.name), job);
        if ("error" in quote) return update({ status: "failed", error: quote.error, ...clearLease });
        const zoneIdsBeforeRegistration = this.providers.listRoute53HostedZoneIds
          ? await this.providers.listRoute53HostedZoneIds(job.name)
          : undefined;
        const providerState = {
          ...job.provider_state,
          quoted_price_usd: quote.totalPriceUsd,
          currency: quote.currency,
          ...(zoneIdsBeforeRegistration
            ? { route53_zone_ids_before_registration: [...new Set(zoneIdsBeforeRegistration)].sort() }
            : {}),
          registration_submitted_at: this.now().toISOString(),
        };
        const submitting = await this.store.update(job.id, {
          status: "registration_submitting",
          attempts: 0,
          error: null,
          provider_state: providerState,
        }, leaseToken);
        if (!submitting) throw new Error("failed to record registration intent");
        let submitted: { operationId: string };
        try {
          submitted = await this.providers.submitRegistration({
            name: job.name,
            years: job.years,
            autoRenew: job.auto_renew,
          });
        } catch (error) {
          return (await this.store.update(job.id, {
            status: "manual_review",
            error: `registration submission outcome is ambiguous: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000),
            lease_token: null,
            lease_until: null,
          }, leaseToken))!;
        }
        return (await this.store.update(job.id, {
          status: "registration_submitted",
          provider_state: { ...submitting.provider_state, registration_operation_id: submitted.operationId },
          lease_token: null,
          lease_until: null,
        }, leaseToken))!;
      }
      case "registration_submitting": {
        const detail = await this.providers.getDomainDetail(job.name);
        if (!detail) return update({ status: "manual_review", error: "registration submission outcome is ambiguous", ...clearLease });
        return update({ status: "registered", ...clearLease });
      }
      case "registration_submitted": {
        const operationId = job.provider_state.registration_operation_id;
        if (!operationId) return update({ status: "manual_review", error: "registration operation id is missing", ...clearLease });
        const status = await this.providers.getOperationStatus(operationId);
        const verdict = operationVerdict(status.status);
        if (verdict === "pending") {
          return update({ provider_state: { ...job.provider_state, last_provider_status: status.status }, ...clearLease });
        }
        if (verdict === "failed") {
          return update({ status: "failed", error: status.message || `registration ${status.status}`, ...clearLease });
        }
        return update({ status: "registered", provider_state: { ...job.provider_state, last_provider_status: status.status }, ...clearLease });
      }
      case "registered": {
        const zone = await this.providers.ensureCloudflareZone(job.name);
        return update({
          status: "zone_ready",
          provider_state: {
            ...job.provider_state,
            cloudflare_zone_id: zone.id,
            cloudflare_nameservers: zone.nameservers,
          },
          ...clearLease,
        });
      }
      case "zone_ready": {
        const nameservers = job.provider_state.cloudflare_nameservers ?? [];
        if (!nameservers.length) return update({ status: "failed", error: "Cloudflare zone returned no nameservers", ...clearLease });
        const operation = await this.providers.updateNameservers(job.name, nameservers);
        return update({
          status: "nameservers_submitted",
          provider_state: {
            ...job.provider_state,
            nameserver_operation_id: operation.operationId,
            nameservers_submitted_at: this.now().toISOString(),
          },
          ...clearLease,
        });
      }
      case "nameservers_submitted": {
        const operationId = job.provider_state.nameserver_operation_id;
        if (!operationId) return update({ status: "manual_review", error: "nameserver operation id is missing", ...clearLease });
        const status = await this.providers.getOperationStatus(operationId);
        const verdict = operationVerdict(status.status);
        if (verdict === "pending") return update({ provider_state: { ...job.provider_state, last_provider_status: status.status }, ...clearLease });
        if (verdict === "failed") return update({ status: "failed", error: status.message || `nameserver update ${status.status}`, ...clearLease });
        return update({ status: "delegated", provider_state: { ...job.provider_state, last_provider_status: status.status }, ...clearLease });
      }
      case "delegated": {
        const detail = await this.providers.getDomainDetail(job.name);
        const zone = await this.providers.ensureCloudflareZone(job.name);
        const publicNameservers = await this.providers.resolvePublicNameservers(job.name);
        if (!detail || zone.status !== "active" || !nameserversEqual(detail.nameservers, zone.nameservers) || !nameserversEqual(publicNameservers, zone.nameservers)) {
          return update({ ...clearLease });
        }
        await this.providers.bindWorkerDomain({
          hostname: job.name,
          zoneId: zone.id,
          workerName: job.worker_name,
        });
        return update({
          status: "worker_bound",
          provider_state: {
            ...job.provider_state,
            cloudflare_zone_id: zone.id,
            cloudflare_nameservers: zone.nameservers,
            worker_domain_bound: true,
          },
          ...clearLease,
        });
      }
      case "worker_bound": {
        const zoneId = job.provider_state.cloudflare_zone_id;
        if (!zoneId) return update({ status: "manual_review", error: "Cloudflare zone id is missing", ...clearLease });
        const ready = await this.providers.workerDomainReady({
          hostname: job.name,
          zoneId,
          workerName: job.worker_name,
        });
        if (!ready) return update({ ...clearLease });
        const detail = await this.providers.getDomainDetail(job.name);
        if (!detail) return update({ status: "manual_review", error: "registered domain detail is missing", ...clearLease });
        // Update the portfolio before making the job terminal. If this write
        // fails, the worker-bound job remains retryable instead of becoming a
        // ready job whose portfolio projection can never be repaired.
        let finalProviderState = { ...job.provider_state };
        const baseline = finalProviderState.route53_zone_ids_before_registration;
        if (
          !finalProviderState.route53_hosted_zone_id
          && baseline
          && this.providers.listRoute53HostedZoneIds
        ) {
          const currentIds = [...new Set(await this.providers.listRoute53HostedZoneIds(job.name))].sort();
          const newIds = currentIds.filter((id) => !baseline.includes(id));
          if (newIds.length === 1) {
            finalProviderState.route53_hosted_zone_id = newIds[0];
          } else if (newIds.length > 1) {
            this.log("route53_zone_cleanup_skipped", {
              id: job.id,
              name: job.name,
              reason: "multiple new hosted zones appeared after registration",
            });
          }
        }
        const readyJob: DomainProvisioningJob = {
          ...job,
          status: "ready",
          provider_state: finalProviderState,
          attempts: nextAttempts,
          error: null,
          lease_token: null,
          lease_until: null,
        };
        await this.store.markPortfolioReady(readyJob, detail);
        const completed = await update({
          status: "ready",
          provider_state: finalProviderState,
          ...clearLease,
        });
        const hostedZoneId = finalProviderState.route53_hosted_zone_id;
        if (this.providers.cleanupRoute53HostedZone && hostedZoneId) {
          try {
            const cleaned = await this.providers.cleanupRoute53HostedZone({
              name: job.name,
              hostedZoneId,
              registrarNameservers: detail.nameservers,
            });
            if (cleaned) {
              finalProviderState = { ...finalProviderState, route53_hosted_zone_cleaned: true };
              await this.store.update(job.id, { provider_state: finalProviderState });
            }
          } catch (error) {
            this.log("route53_zone_cleanup_deferred", {
              id: job.id,
              name: job.name,
              error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
            });
          }
        }
        return (await this.store.get(job.id)) ?? completed;
      }
      default:
        return update({ ...clearLease });
    }
  }

  async runOnce(): Promise<{ processed: number; ready: number; failed: number }> {
    const jobs = await this.store.listRunnable(this.batchSize);
    let ready = 0;
    let failed = 0;
    for (const job of jobs) {
      const result = await this.advance(job.id);
      if (result.status === "ready") ready++;
      if (result.status === "failed" || result.status === "manual_review") failed++;
    }
    return { processed: jobs.length, ready, failed };
  }

  private async runScheduledOnce(): Promise<void> {
    if (this.scheduledRunActive) return;
    this.scheduledRunActive = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.log("domain_provisioning_worker_error", {
        error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      });
    } finally {
      this.scheduledRunActive = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runScheduledOnce(), this.intervalMs);
    this.timer.unref?.();
    void this.runScheduledOnce();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

export function isProvisioningTerminal(status: ProvisioningStatus): boolean {
  return TERMINAL.has(status);
}

export type PublicDomainProvisioningJob = Omit<DomainProvisioningJob, "lease_token">;

/** Strip the worker lease credential from every API response. */
export function publicProvisioningJob(job: DomainProvisioningJob): PublicDomainProvisioningJob {
  const { lease_token: _leaseToken, ...safe } = job;
  return safe;
}

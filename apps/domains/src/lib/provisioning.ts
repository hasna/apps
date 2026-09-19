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
export type OriginTlsMode = "strict" | "full";
export type ProvisioningRegistrar = "route53" | "brandsight";

export interface DomainProvisioningRequest {
  name: string;
  idempotency_key: string;
  max_price_usd: number;
  years: number;
  auto_renew: boolean;
  acquisition_mode: "purchase" | "adopt";
  registrar: ProvisioningRegistrar;
  dns_provider: "cloudflare";
  target: "shortlinks" | "website_origin";
  worker_name: string | null;
  origin_hostname: string | null;
  origin_tls_mode: OriginTlsMode | null;
}

export interface ProvisionedWebRecord {
  type: "CNAME";
  name: string;
  value: string;
  proxied: true;
  ttl: number;
}

export interface DomainProvisioningResult {
  zone_ref: string;
  nameservers: string[];
  web_records: ProvisionedWebRecord[];
  origin_tls_mode: OriginTlsMode | null;
  checked_at: string;
}

export const HOSTED_DNS_RECORD_TYPES = ["TXT", "CNAME", "MX"] as const;
export type HostedDnsRecordType = (typeof HOSTED_DNS_RECORD_TYPES)[number];

export interface HostedDnsRecord {
  type: HostedDnsRecordType;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
}

export interface DomainDnsReconciliation {
  id: string;
  provisioning_job_id: string;
  domain_name: string;
  idempotency_key: string;
  request_hash: string;
  status: "requested" | "applying" | "ready" | "manual_review";
  records: HostedDnsRecord[];
  result: { records: HostedDnsRecord[]; checked_at: string } | null;
  error: string | null;
  lease_token: string | null;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicDomainDnsReconciliation = Omit<DomainDnsReconciliation, "lease_token">;

export function publicDnsReconciliation(
  reconciliation: DomainDnsReconciliation,
): PublicDomainDnsReconciliation {
  const { lease_token: _leaseToken, ...safe } = reconciliation;
  return safe;
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
  website_origin_configured?: boolean;
  origin_tls_mode_configured?: OriginTlsMode | "origin_pull";
  origin_tls_mode_checked_at?: string;
  web_records?: ProvisionedWebRecord[];
  target_checked_at?: string;
  last_provider_status?: string;
  registration_submitted_at?: string;
  nameservers_submitted_at?: string;
  delegation_dns_preserved_count?: number;
  delegation_dns_preserved_sha256?: string;
  delegation_dns_preserved_at?: string;
}

export interface PortfolioDomainRegistration extends RegisteredDomainDetail {
  id: string;
  status: string;
  registrar: string;
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
  getByName(name: string): Promise<DomainProvisioningJob | null>;
  getPortfolioRegistration(name: string): Promise<PortfolioDomainRegistration | null>;
  listRunnable(limit: number): Promise<DomainProvisioningJob[]>;
  claim(id: string, leaseToken: string, leaseUntil: string): Promise<DomainProvisioningJob | null>;
  update(
    id: string,
    patch: Partial<Pick<DomainProvisioningJob, "status" | "provider_state" | "attempts" | "error" | "lease_token" | "lease_until">>,
    leaseToken?: string,
  ): Promise<DomainProvisioningJob | null>;
  markPortfolioReady(job: DomainProvisioningJob, detail: RegisteredDomainDetail): Promise<void>;
  reserveAdoption(
    request: DomainProvisioningRequest,
    requestHash: string,
    detail: RegisteredDomainDetail,
  ): Promise<DomainProvisioningJob>;
  reserveDnsReconciliation(input: {
    job: DomainProvisioningJob;
    idempotencyKey: string;
    requestHash: string;
    records: HostedDnsRecord[];
  }): Promise<DomainDnsReconciliation>;
  claimDnsReconciliation(id: string, leaseToken: string, leaseUntil: string): Promise<DomainDnsReconciliation | null>;
  updateDnsReconciliation(
    id: string,
    patch: Partial<Pick<DomainDnsReconciliation, "status" | "result" | "error" | "lease_token" | "lease_until">>,
    leaseToken: string,
  ): Promise<DomainDnsReconciliation | null>;
}

export interface AvailabilityQuote {
  available: boolean;
  price_usd?: number;
  registration_price_usd?: number;
  renewal_price_usd?: number;
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

export interface DelegationDnsPreservation {
  count: number;
  sha256: string;
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
  getDomainDetail(name: string, registrar?: ProvisioningRegistrar): Promise<RegisteredDomainDetail | null>;
  ensureCloudflareZone(name: string): Promise<CloudflareZoneState>;
  updateNameservers(
    name: string,
    nameservers: string[],
    registrar?: ProvisioningRegistrar,
  ): Promise<{ operationId: string; completed?: boolean }>;
  resolvePublicNameservers(name: string): Promise<string[]>;
  preserveRegistrarDnsBeforeDelegation(input: {
    hostname: string;
    zoneId: string;
    registrar: ProvisioningRegistrar;
  }): Promise<DelegationDnsPreservation>;
  bindWorkerDomain(input: { hostname: string; zoneId: string; workerName: string }): Promise<void>;
  workerDomainReady(input: { hostname: string; zoneId: string; workerName: string }): Promise<boolean>;
  configureWebsiteOrigin(input: {
    hostname: string;
    zoneId: string;
    originHostname: string;
  }): Promise<ProvisionedWebRecord[]>;
  ensureWebsiteOriginTls(input: {
    zoneId: string;
    requestedMode: OriginTlsMode;
  }): Promise<{
    mode: OriginTlsMode | "origin_pull";
    changed: boolean;
    downgradeRefused: boolean;
  }>;
  websiteOriginReady(input: {
    hostname: string;
    zoneId: string;
    originHostname: string;
    originTlsMode: OriginTlsMode;
  }): Promise<boolean>;
  reconcileDnsRecords(input: {
    hostname: string;
    zoneId: string;
    records: HostedDnsRecord[];
  }): Promise<HostedDnsRecord[]>;
  dnsRecordsReady(input: {
    hostname: string;
    zoneId: string;
    records: HostedDnsRecord[];
  }): Promise<boolean>;
  listRoute53HostedZoneIds?(name: string): Promise<string[]>;
  cleanupRoute53HostedZone?(input: {
    name: string;
    hostedZoneId: string;
    registrarNameservers: string[];
  }): Promise<boolean>;
}

export class RegistrarActionRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrarActionRequiredError";
  }
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

function hashProvisioningIntent(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Current canonical hash for a normalized provisioning request. */
export function provisioningRequestHash(request: DomainProvisioningRequest): string {
  return hashProvisioningIntent({
    auto_renew: request.auto_renew,
    acquisition_mode: request.acquisition_mode,
    dns_provider: request.dns_provider,
    max_price_usd: request.max_price_usd,
    name: request.name,
    registrar: request.registrar,
    target: request.target,
    worker_name: request.worker_name,
    origin_hostname: request.origin_hostname,
    ...(request.target === "website_origin" ? { origin_tls_mode: request.origin_tls_mode } : {}),
    years: request.years,
  });
}

/**
 * Accept a stored request hash only when it is either the current canonical
 * hash or the exact pre-origin-fields hash used by legacy Shortlinks purchase
 * jobs. The caller-supplied current hash must itself be canonical, so an
 * arbitrary mismatched hash cannot use this compatibility path.
 */
export function provisioningRequestHashMatches(
  storedHash: string,
  currentHash: string,
  request: DomainProvisioningRequest,
): boolean {
  const canonicalHash = provisioningRequestHash(request);
  if (currentHash !== canonicalHash) return false;
  if (storedHash === canonicalHash) return true;
  if (
    request.acquisition_mode !== "purchase" ||
    request.target !== "shortlinks" ||
    request.origin_hostname !== null ||
    request.origin_tls_mode !== null
  ) return false;
  const legacyHash = hashProvisioningIntent({
    auto_renew: request.auto_renew,
    dns_provider: request.dns_provider,
    max_price_usd: request.max_price_usd,
    name: request.name,
    registrar: request.registrar,
    target: request.target,
    worker_name: request.worker_name,
    years: request.years,
  });
  return storedHash === legacyHash;
}

function dnsRecordName(value: unknown, domain: string): string {
  if (typeof value !== "string") throw new Error("DNS record name must be a string");
  const name = (value.trim() === "@" ? domain : value.trim()).toLowerCase().replace(/\.$/u, "");
  if (
    name.length > 253 ||
    !/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*$/u.test(name) ||
    (name !== domain && !name.endsWith(`.${domain}`))
  ) {
    throw new Error("DNS record name must be the domain or one of its subdomains");
  }
  return name;
}

function dnsHostnameValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("DNS record value must be a hostname");
  const hostname = value.trim().toLowerCase().replace(/\.$/u, "");
  if (
    hostname.length > 253 ||
    !/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*$/u.test(hostname)
  ) {
    throw new Error("DNS record value must be a hostname");
  }
  return hostname;
}

export function normalizeHostedDnsRecords(value: unknown, domainValue: string): HostedDnsRecord[] {
  const domain = normalizeDomainName(domainValue);
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new Error("records must contain 1-20 DNS records");
  }
  const records = value.map((raw): HostedDnsRecord => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid DNS record");
    const input = raw as Record<string, unknown>;
    const type = String(input.type ?? "").toUpperCase();
    if (!HOSTED_DNS_RECORD_TYPES.includes(type as HostedDnsRecordType)) {
      throw new Error("hosted DNS reconciliation allows only TXT, CNAME, and MX records");
    }
    const ttl = Number(input.ttl ?? 300);
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86_400) {
      throw new Error("DNS record ttl must be an integer from 60 to 86400");
    }
    const recordType = type as HostedDnsRecordType;
    const value = recordType === "TXT"
      ? (() => {
          if (typeof input.value !== "string" || !input.value.trim() || input.value.length > 4_096 || /[\r\n\0]/u.test(input.value)) {
            throw new Error("TXT record value must be 1-4096 characters without control lines");
          }
          return input.value;
        })()
      : dnsHostnameValue(input.value);
    const priority = recordType === "MX" ? Number(input.priority) : null;
    if (recordType === "MX" && (!Number.isInteger(priority) || Number(priority) < 0 || Number(priority) > 65_535)) {
      throw new Error("MX record priority must be an integer from 0 to 65535");
    }
    if (recordType !== "MX" && input.priority !== undefined && input.priority !== null) {
      throw new Error("priority is valid only for MX records");
    }
    return { type: recordType, name: dnsRecordName(input.name, domain), value, ttl, priority };
  });
  const canonical = [...records].sort((left, right) => {
    const leftJson = JSON.stringify(left);
    const rightJson = JSON.stringify(right);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
  const identities = canonical.map((record) => JSON.stringify(record));
  if (new Set(identities).size !== identities.length) throw new Error("duplicate DNS records are not allowed");
  return canonical;
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
  if (registrar !== "route53") throw new Error("only registrar=route53 is supported by hosted provisioning");
  if (dnsProvider !== "cloudflare") throw new Error("only dns_provider=cloudflare is supported by hosted provisioning");
  if (target !== "shortlinks" && target !== "website_origin") {
    throw new Error("target must be shortlinks or website_origin");
  }
  let workerName: string | null = null;
  let originHostname: string | null = null;
  let originTlsMode: OriginTlsMode | null = null;
  if (target === "shortlinks") {
    if (input.origin_hostname !== undefined && input.origin_hostname !== null) {
      throw new Error("origin_hostname is only valid for target=website_origin");
    }
    if (input.origin_tls_mode !== undefined && input.origin_tls_mode !== null) {
      throw new Error("origin_tls_mode is only valid for target=website_origin");
    }
    workerName = String(input.worker_name ?? "hasna-link-router").trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(workerName)) throw new Error("invalid worker_name");
  } else {
    if (input.worker_name !== undefined && input.worker_name !== null) {
      throw new Error("worker_name is only valid for target=shortlinks");
    }
    originHostname = normalizeWebsiteOriginHostname(input.origin_hostname);
    const requestedTlsMode = input.origin_tls_mode ?? "strict";
    if (requestedTlsMode !== "strict" && requestedTlsMode !== "full") {
      throw new Error("origin_tls_mode must be strict or full");
    }
    originTlsMode = requestedTlsMode;
  }
  return {
    name,
    idempotency_key: idempotencyKey,
    max_price_usd: maxPrice,
    years,
    auto_renew: input.auto_renew,
    acquisition_mode: "purchase",
    registrar,
    dns_provider: dnsProvider,
    target,
    worker_name: workerName,
    origin_hostname: originHostname,
    origin_tls_mode: originTlsMode,
  };
}

function adoptionRegistrar(value: string): ProvisioningRegistrar {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
  if (
    normalized === "route53"
    || normalized === "route 53"
    || normalized === "aws route 53"
    || normalized === "amazon registrar"
  ) {
    return "route53";
  }
  if (normalized === "brandsight" || normalized === "godaddy corporate domains") {
    return "brandsight";
  }
  throw new RegistrarActionRequiredError(
    `owned domain registrar '${value}' is not supported by hosted provisioning`,
  );
}

/** A hosted website origin is an AWS ALB DNS hostname, never a URL or an IP. */
export function normalizeWebsiteOriginHostname(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("origin_hostname is required for target=website_origin");
  }
  const hostname = value.trim().toLowerCase().replace(/\.$/u, "");
  if (
    hostname.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z0-9-]+\.elb\.amazonaws\.com$/u.test(hostname)
  ) {
    throw new Error("origin_hostname must be an AWS ALB DNS hostname");
  }
  return hostname;
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
  const unitRegistrationPrice = quote.registration_price_usd ?? quote.price_usd;
  if (!Number.isFinite(unitRegistrationPrice) || unitRegistrationPrice! <= 0) {
    return { error: "registrar returned no positive bounded purchase price" };
  }
  const currency = (quote.currency ?? "USD").toUpperCase();
  if (currency !== "USD") return { error: `registrar returned unsupported currency ${currency}` };
  const totalPriceUsd = Number((unitRegistrationPrice! * request.years).toFixed(2));
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
    if (input.acquisition_mode !== undefined && input.acquisition_mode !== "purchase") {
      throw new Error("use the adoption endpoint for acquisition_mode=adopt");
    }
    const normalized = normalizeRequest(input);
    return this.store.reserve(normalized, provisioningRequestHash(normalized));
  }

  async adopt(input: {
    name?: unknown;
    idempotency_key?: unknown;
    dns_provider?: unknown;
    target?: unknown;
    worker_name?: unknown;
    origin_hostname?: unknown;
    origin_tls_mode?: unknown;
  }): Promise<DomainProvisioningJob> {
    const normalized = normalizeRequest({
      name: input.name as string,
      idempotency_key: input.idempotency_key as string,
      max_price_usd: 1,
      years: 1,
      auto_renew: true,
      registrar: "route53",
      dns_provider: input.dns_provider as "cloudflare" | undefined,
      target: input.target as DomainProvisioningRequest["target"] | undefined,
      worker_name: input.worker_name as string | null | undefined,
      origin_hostname: input.origin_hostname as string | null | undefined,
      origin_tls_mode: input.origin_tls_mode as OriginTlsMode | null | undefined,
    });
    const existing = await this.store.getByName(normalized.name);
    const portfolio = existing
      ? null
      : await this.store.getPortfolioRegistration(normalized.name);
    if (!existing && !portfolio) {
      throw new RegistrarActionRequiredError(
        "owned domain is not present in the hosted Domains portfolio",
      );
    }
    if (portfolio && portfolio.status !== "active" && portfolio.status !== "purchased") {
      throw new RegistrarActionRequiredError(
        `owned domain portfolio status '${portfolio.status}' is not eligible for adoption`,
      );
    }
    const registrar = existing?.registrar ?? adoptionRegistrar(portfolio!.registrar);
    const request: DomainProvisioningRequest = {
      ...normalized,
      acquisition_mode: "adopt",
      max_price_usd: 0,
      registrar,
    };
    const hash = provisioningRequestHash(request);
    if (await this.store.getByName(request.name)) {
      return this.store.reserveAdoption(request, hash, { nameservers: [] });
    }
    const detail = await this.providers.getDomainDetail(normalized.name, registrar);
    if (!detail) {
      throw new RegistrarActionRequiredError(
        `${registrar} does not report this portfolio domain as already owned`,
      );
    }
    if (detail.registrar && adoptionRegistrar(detail.registrar) !== registrar) {
      throw new RegistrarActionRequiredError(
        "registrar ownership readback does not match the portfolio authority",
      );
    }
    return this.store.reserveAdoption(request, hash, detail);
  }

  get(id: string): Promise<DomainProvisioningJob | null> {
    return this.store.get(id);
  }

  getByName(name: string): Promise<DomainProvisioningJob | null> {
    return this.store.getByName(normalizeDomainName(name));
  }

  async reconcileDns(
    name: string,
    input: { idempotency_key?: unknown; records?: unknown },
  ): Promise<DomainDnsReconciliation> {
    const canonicalName = normalizeDomainName(name);
    const idempotencyKey = String(input.idempotency_key ?? "").trim();
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new Error("idempotency_key must be 8-128 safe characters");
    }
    const records = normalizeHostedDnsRecords(input.records, canonicalName);
    const job = await this.store.getByName(canonicalName);
    if (!job || job.status !== "ready") throw new Error("domain provisioning job is not ready");
    const zoneId = job.provider_state.cloudflare_zone_id;
    if (!zoneId) throw new Error("provisioned domain has no DNS zone");
    const hash = createHash("sha256").update(JSON.stringify({
      domain_name: canonicalName,
      records,
    })).digest("hex");
    let reconciliation = await this.store.reserveDnsReconciliation({
      job,
      idempotencyKey,
      requestHash: hash,
      records,
    });
    if (reconciliation.status === "ready") return reconciliation;
    const leaseToken = randomUUID();
    const leaseUntil = new Date(this.now().getTime() + this.leaseMs).toISOString();
    const claimed = await this.store.claimDnsReconciliation(reconciliation.id, leaseToken, leaseUntil);
    if (!claimed) return reconciliation;
    try {
      await this.store.updateDnsReconciliation(claimed.id, {
        status: "applying", error: null,
      }, leaseToken);
      const applied = await this.providers.reconcileDnsRecords({
        hostname: canonicalName,
        zoneId,
        records,
      });
      if (!await this.providers.dnsRecordsReady({ hostname: canonicalName, zoneId, records })) {
        throw new Error("DNS provider readback does not match the requested records");
      }
      reconciliation = (await this.store.updateDnsReconciliation(claimed.id, {
        status: "ready",
        result: { records: applied, checked_at: this.now().toISOString() },
        error: null,
        lease_token: null,
        lease_until: null,
      }, leaseToken))!;
      return reconciliation;
    } catch (error) {
      const updated = await this.store.updateDnsReconciliation(claimed.id, {
        status: "manual_review",
        error: `DNS reconciliation outcome requires review: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000),
        lease_token: null,
        lease_until: null,
      }, leaseToken);
      return updated ?? claimed;
    }
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
      const actionRequired = error instanceof RegistrarActionRequiredError;
      const status: ProvisioningStatus = ambiguous || actionRequired
        ? "manual_review"
        : claimed.status;
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
        const detail = await this.providers.getDomainDetail(job.name, job.registrar);
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
        const publicNameservers = await this.providers.resolvePublicNameservers(job.name);
        if (job.acquisition_mode === "adopt" && nameserversEqual(publicNameservers, nameservers)) {
          return update({
            status: "delegated",
            provider_state: {
              ...job.provider_state,
              last_provider_status: "PUBLIC_NAMESERVERS_ALREADY_DELEGATED",
            },
            ...clearLease,
          });
        }
        if (job.acquisition_mode === "adopt") {
          const zoneId = job.provider_state.cloudflare_zone_id;
          if (!zoneId) {
            return update({ status: "manual_review", error: "Cloudflare zone id is missing", ...clearLease });
          }
          if (job.target === "website_origin") {
            if (!job.origin_tls_mode) {
              return update({ status: "manual_review", error: "website origin TLS mode is missing", ...clearLease });
            }
            const tls = await this.providers.ensureWebsiteOriginTls({
              zoneId,
              requestedMode: job.origin_tls_mode,
            });
            if (tls.downgradeRefused) {
              return update({
                status: "manual_review",
                error: `refused to weaken existing Cloudflare ${tls.mode} origin TLS mode to ${job.origin_tls_mode}`,
                provider_state: {
                  ...job.provider_state,
                  origin_tls_mode_configured: tls.mode,
                  origin_tls_mode_checked_at: this.now().toISOString(),
                },
                ...clearLease,
              });
            }
            if (tls.mode !== job.origin_tls_mode) {
              return update({
                status: "manual_review",
                error: `Cloudflare origin TLS readback is ${tls.mode}, expected ${job.origin_tls_mode}`,
                provider_state: {
                  ...job.provider_state,
                  origin_tls_mode_configured: tls.mode,
                  origin_tls_mode_checked_at: this.now().toISOString(),
                },
                ...clearLease,
              });
            }
            if (job.provider_state.origin_tls_mode_configured !== job.origin_tls_mode) {
              return update({
                provider_state: {
                  ...job.provider_state,
                  origin_tls_mode_configured: job.origin_tls_mode,
                  origin_tls_mode_checked_at: this.now().toISOString(),
                },
                ...clearLease,
              });
            }
          }
          const hasDnsPreservationCheckpoint =
            job.provider_state.delegation_dns_preserved_count !== undefined
            && /^[0-9a-f]{64}$/u.test(job.provider_state.delegation_dns_preserved_sha256 ?? "");
          const registrarDetail = await this.providers.getDomainDetail(job.name, job.registrar);
          if (registrarDetail && nameserversEqual(registrarDetail.nameservers, nameservers)) {
            if (!hasDnsPreservationCheckpoint) {
              return update({
                status: "manual_review",
                error: "registrar nameservers changed before the DNS preservation checkpoint was recorded",
                ...clearLease,
              });
            }
            return update({
              status: "delegated",
              provider_state: {
                ...job.provider_state,
                nameservers_submitted_at: job.provider_state.nameservers_submitted_at ?? this.now().toISOString(),
                last_provider_status: "REGISTRAR_NAMESERVERS_ALREADY_DELEGATED",
              },
              ...clearLease,
            });
          }
          const preservation = await this.providers.preserveRegistrarDnsBeforeDelegation({
            hostname: job.name,
            zoneId,
            registrar: job.registrar,
          });
          const previousHash = job.provider_state.delegation_dns_preserved_sha256;
          const previousCount = job.provider_state.delegation_dns_preserved_count;
          if (previousHash !== preservation.sha256 || previousCount !== preservation.count) {
            return update({
              provider_state: {
                ...job.provider_state,
                delegation_dns_preserved_count: preservation.count,
                delegation_dns_preserved_sha256: preservation.sha256,
                delegation_dns_preserved_at: this.now().toISOString(),
              },
              ...clearLease,
            });
          }
        }
        const operation = await this.providers.updateNameservers(
          job.name,
          nameservers,
          job.registrar,
        );
        if (operation.completed === true) {
          return update({
            status: "delegated",
            provider_state: {
              ...job.provider_state,
              nameserver_operation_id: operation.operationId,
              nameservers_submitted_at: this.now().toISOString(),
              last_provider_status: "SUCCESSFUL",
            },
            ...clearLease,
          });
        }
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
        const detail = await this.providers.getDomainDetail(job.name, job.registrar);
        const zone = await this.providers.ensureCloudflareZone(job.name);
        const publicNameservers = await this.providers.resolvePublicNameservers(job.name);
        if (!detail || zone.status !== "active" || !nameserversEqual(detail.nameservers, zone.nameservers) || !nameserversEqual(publicNameservers, zone.nameservers)) {
          return update({ ...clearLease });
        }
        let targetState: DomainProvisioningProviderState;
        if (job.target === "website_origin") {
          if (!job.origin_hostname || !job.origin_tls_mode) {
            return update({ status: "manual_review", error: "website origin configuration is missing", ...clearLease });
          }
          const tls = await this.providers.ensureWebsiteOriginTls({
            zoneId: zone.id,
            requestedMode: job.origin_tls_mode,
          });
          if (tls.downgradeRefused) {
            return update({
              status: "manual_review",
              error: `refused to weaken existing Cloudflare ${tls.mode} origin TLS mode to ${job.origin_tls_mode}`,
              provider_state: {
                ...job.provider_state,
                origin_tls_mode_configured: tls.mode,
                origin_tls_mode_checked_at: this.now().toISOString(),
              },
              ...clearLease,
            });
          }
          if (tls.mode !== job.origin_tls_mode) {
            return update({
              status: "manual_review",
              error: `Cloudflare origin TLS readback is ${tls.mode}, expected ${job.origin_tls_mode}`,
              provider_state: {
                ...job.provider_state,
                origin_tls_mode_configured: tls.mode,
                origin_tls_mode_checked_at: this.now().toISOString(),
              },
              ...clearLease,
            });
          }
          const webRecords = await this.providers.configureWebsiteOrigin({
            hostname: job.name,
            zoneId: zone.id,
            originHostname: job.origin_hostname,
          });
          targetState = {
            website_origin_configured: true,
            origin_tls_mode_configured: job.origin_tls_mode,
            origin_tls_mode_checked_at: this.now().toISOString(),
            web_records: webRecords,
          };
        } else {
          if (!job.worker_name) {
            return update({ status: "manual_review", error: "worker name is missing", ...clearLease });
          }
          await this.providers.bindWorkerDomain({
            hostname: job.name,
            zoneId: zone.id,
            workerName: job.worker_name,
          });
          targetState = { worker_domain_bound: true };
        }
        return update({
          status: "worker_bound",
          provider_state: {
            ...job.provider_state,
            cloudflare_zone_id: zone.id,
            cloudflare_nameservers: zone.nameservers,
            ...targetState,
          },
          ...clearLease,
        });
      }
      case "worker_bound": {
        const zoneId = job.provider_state.cloudflare_zone_id;
        if (!zoneId) return update({ status: "manual_review", error: "Cloudflare zone id is missing", ...clearLease });
        let ready: boolean;
        if (job.target === "website_origin") {
          if (!job.origin_hostname || !job.origin_tls_mode) {
            return update({ status: "manual_review", error: "website origin configuration is missing", ...clearLease });
          }
          ready = await this.providers.websiteOriginReady({
            hostname: job.name,
            zoneId,
            originHostname: job.origin_hostname,
            originTlsMode: job.origin_tls_mode,
          });
        } else {
          if (!job.worker_name) {
            return update({ status: "manual_review", error: "worker name is missing", ...clearLease });
          }
          ready = await this.providers.workerDomainReady({
            hostname: job.name,
            zoneId,
            workerName: job.worker_name,
          });
        }
        if (!ready) return update({ ...clearLease });
        const detail = await this.providers.getDomainDetail(job.name, job.registrar);
        if (!detail) return update({ status: "manual_review", error: "registered domain detail is missing", ...clearLease });
        // Update the portfolio before making the job terminal. If this write
        // fails, the worker-bound job remains retryable instead of becoming a
        // ready job whose portfolio projection can never be repaired.
        let finalProviderState = {
          ...job.provider_state,
          target_checked_at: this.now().toISOString(),
        };
        const baseline = finalProviderState.route53_zone_ids_before_registration;
        if (
          job.registrar === "route53"
          &&
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
        if (job.registrar === "route53" && this.providers.cleanupRoute53HostedZone && hostedZoneId) {
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

export type PublicDomainProvisioningJob = Omit<DomainProvisioningJob, "lease_token"> & {
  result: DomainProvisioningResult | null;
};

/** Strip the worker lease credential from every API response. */
export function publicProvisioningJob(job: DomainProvisioningJob): PublicDomainProvisioningJob {
  const { lease_token: _leaseToken, ...safe } = job;
  const zoneRef = job.provider_state.cloudflare_zone_id;
  const checkedAt = job.provider_state.target_checked_at;
  const nameservers = job.provider_state.cloudflare_nameservers;
  const webRecords = job.provider_state.web_records;
  const configuredTlsMode = job.provider_state.origin_tls_mode_configured;
  const result =
    job.status === "ready" &&
    zoneRef &&
    checkedAt &&
    Array.isArray(nameservers) &&
    (job.target === "shortlinks" || (
      Array.isArray(webRecords) &&
      configuredTlsMode === job.origin_tls_mode
    ))
      ? {
          zone_ref: `zone:${createHash("sha256").update(zoneRef).digest("hex").slice(0, 24)}`,
          nameservers: [...nameservers],
          web_records: job.target === "website_origin" ? [...(webRecords ?? [])] : [],
          origin_tls_mode: job.target === "website_origin" ? job.origin_tls_mode : null,
          checked_at: checkedAt,
        }
      : null;
  return { ...safe, result };
}

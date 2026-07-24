/**
 * AWS Route 53 provider — domain registration, hosted zones, and DNS management
 *
 * Supports:
 *   - Domain availability check + purchase via Route 53 Domains
 *   - Hosted zone CRUD via Route 53
 *   - DNS record management (list, upsert, delete)
 *
 * Env vars:
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (optional, defaults to us-east-1)
 */

import {
  Route53Client,
  CreateHostedZoneCommand,
  ListHostedZonesCommand,
  GetHostedZoneCommand,
  DeleteHostedZoneCommand,
  ChangeResourceRecordSetsCommand,
  ListResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
  type ResourceRecordSet,
} from "@aws-sdk/client-route-53";
import {
  Route53DomainsClient,
  CheckDomainAvailabilityCommand,
  DisableDomainTransferLockCommand,
  GetDomainDetailCommand,
  GetOperationDetailCommand,
  ListDomainsCommand,
  ListPricesCommand,
  RegisterDomainCommand,
  RetrieveDomainAuthCodeCommand,
  TransferDomainCommand,
  UpdateDomainNameserversCommand,
  type CountryCode,
  type DomainPrice,
} from "@aws-sdk/client-route-53-domains";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import type {
  FullProvider,
  ProviderDomainInfo,
  ProviderDnsRecord,
  ProviderRenewResult,
  ProviderSyncResult,
  ProviderAvailability,
  DbFunctions,
} from "./registrar.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Route53Config {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  profile?: string;
}

export interface DomainContactInfo {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state?: string;
  country_code: string;
  zip_code: string;
  organization_name?: string;
}

export interface DomainAvailability {
  domain: string;
  available: boolean;
  availability: string;
  price?: string;
  renewal_price?: string;
  transfer_price?: string;
  currency?: string;
}

export interface Route53TldPrice {
  tld: string;
  registration_price?: string;
  renewal_price?: string;
  transfer_price?: string;
  currency?: string;
}

export interface RegisteredDomain {
  domain: string;
  expiry: string;
  auto_renew: boolean;
  transfer_lock: boolean;
}

export interface Route53RegistrarOptions {
  privacy_protected?: boolean;
  nameservers?: string[];
}

export interface Route53OperationStatus {
  status: string;
  domain?: string;
  message?: string;
}

export interface Route53TransferOutAuthCode {
  auth_code: string;
  transfer_lock_disabled: boolean;
  transfer_lock_operation_id: string | null;
}

export interface HostedZoneInfo {
  id: string;
  name: string;
  record_count: number;
  comment?: string;
  name_servers?: string[];
  private_zone?: boolean;
}

export interface Route53Record {
  name: string;
  type: string;
  ttl: number;
  values: string[];
  /** Present when this is an alias record — values will be [] and ttl will be 0 */
  alias_target?: Route53AliasTarget;
}

export interface Route53AliasTarget {
  /** Hosted zone ID of the alias target (e.g. Z2FDTNDATAQYW2 for CloudFront) */
  hosted_zone_id: string;
  /** DNS name of the alias target (e.g. d1234.cloudfront.net) */
  dns_name: string;
}

export interface Route53RecordInput {
  name: string;
  type: string;
  ttl?: number;
  values: string[];
  /** When set, creates an alias record instead of a standard record. TTL and values are ignored. */
  alias_target?: Route53AliasTarget;
}

export interface Route53ChangeResult {
  changeId: string | null;
}

export interface Route53ChangeOptions {
  comment?: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export function getConfig(): Route53Config {
  return {
    region: process.env["ROUTE53_REGION"] || process.env["ROUTE53_AWS_REGION"] || process.env["AWS_REGION"] || "us-east-1",
    accessKeyId: process.env["ROUTE53_ACCESS_KEY_ID"] || process.env["AWS_ACCESS_KEY_ID"],
    secretAccessKey: process.env["ROUTE53_SECRET_ACCESS_KEY"] || process.env["AWS_SECRET_ACCESS_KEY"],
    sessionToken: process.env["ROUTE53_SESSION_TOKEN"] || process.env["AWS_SESSION_TOKEN"],
    profile: process.env["ROUTE53_AWS_PROFILE"] || process.env["AWS_PROFILE"],
  };
}

function makeClients(config?: Route53Config) {
  const cfg = config ?? getConfig();
  const region = cfg.region || "us-east-1";
  const credentials = cfg.accessKeyId && cfg.secretAccessKey
    ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, sessionToken: cfg.sessionToken }
    : cfg.profile
      ? fromIni({ profile: cfg.profile })
      : undefined;

  return {
    route53: new Route53Client({ region, credentials }),
    // Route 53 Domains API only works in us-east-1
    domains: new Route53DomainsClient({ region: "us-east-1", credentials }),
  };
}

// ─── Domain Registration ─────────────────────────────────────────────────────

export async function checkAvailability(domain: string, config?: Route53Config): Promise<DomainAvailability> {
  const { domains } = makeClients(config);

  const result = await domains.send(
    new CheckDomainAvailabilityCommand({ DomainName: domain }),
  );

  const availability: DomainAvailability = {
    domain,
    available: result.Availability === "AVAILABLE",
    availability: result.Availability ?? "UNKNOWN",
  };

  if (availability.available) {
    try {
      const tld = domain.split(".").slice(1).join(".");
      const price = await getTldPrice(tld, config);
      if (price) {
        availability.currency = price.currency;
        availability.price = price.registration_price;
        availability.renewal_price = price.renewal_price;
        availability.transfer_price = price.transfer_price;
      }
    } catch {
      // Pricing not critical
    }
  }

  return availability;
}

function normalizeTld(tld: string): string {
  return tld.trim().replace(/^\./, "");
}

function priceString(value?: number): string | undefined {
  return value == null ? undefined : value.toString();
}

function tldPriceFromRoute53Price(
  tld: string,
  price: DomainPrice,
): Route53TldPrice {
  return {
    tld: price.Name || tld,
    registration_price: priceString(price.RegistrationPrice?.Price),
    renewal_price: priceString(price.RenewalPrice?.Price),
    transfer_price: priceString(price.TransferPrice?.Price),
    currency:
      price.RegistrationPrice?.Currency ??
      price.RenewalPrice?.Currency ??
      price.TransferPrice?.Currency,
  };
}

export async function getTldPrice(
  tld: string,
  config?: Route53Config,
): Promise<Route53TldPrice | null> {
  const { domains } = makeClients(config);
  const normalized = normalizeTld(tld);
  const prices = await domains.send(
    new ListPricesCommand({ Tld: normalized, MaxItems: 1 }),
  );
  const price = prices.Prices?.[0];
  return price ? tldPriceFromRoute53Price(normalized, price) : null;
}

export async function listTldPrices(
  config?: Route53Config,
): Promise<Route53TldPrice[]> {
  const { domains } = makeClients(config);
  const prices: Route53TldPrice[] = [];
  let marker: string | undefined;

  do {
    const result = await domains.send(
      new ListPricesCommand({ Marker: marker, MaxItems: 100 }),
    );
    for (const price of result.Prices ?? []) {
      prices.push(tldPriceFromRoute53Price(price.Name || "", price));
    }
    marker = result.NextPageMarker;
  } while (marker);

  return prices;
}

export async function registerDomain(
  domain: string,
  contact: DomainContactInfo,
  durationYears = 1,
  autoRenew = true,
  config?: Route53Config,
  options: Route53RegistrarOptions = {},
): Promise<{ operationId: string }> {
  const { domains } = makeClients(config);
  const contactDetail = contactToRoute53Contact(contact);

  const result = await domains.send(
    new RegisterDomainCommand({
      DomainName: domain,
      DurationInYears: durationYears,
      AutoRenew: autoRenew,
      AdminContact: contactDetail,
      RegistrantContact: contactDetail,
      TechContact: contactDetail,
      PrivacyProtectAdminContact: options.privacy_protected ?? true,
      PrivacyProtectRegistrantContact: options.privacy_protected ?? true,
      PrivacyProtectTechContact: options.privacy_protected ?? true,
      ...(options.nameservers?.length
        ? { Nameservers: options.nameservers.map((Name) => ({ Name })) }
        : {}),
    }),
  );

  return { operationId: result.OperationId ?? "" };
}

function contactToRoute53Contact(contact: DomainContactInfo) {
  return {
    FirstName: contact.first_name,
    LastName: contact.last_name,
    Email: contact.email,
    PhoneNumber: contact.phone,
    AddressLine1: contact.address_line_1,
    ...(contact.address_line_2 ? { AddressLine2: contact.address_line_2 } : {}),
    City: contact.city,
    ...(contact.state ? { State: contact.state } : {}),
    CountryCode: contact.country_code.toUpperCase() as CountryCode,
    ZipCode: contact.zip_code,
    ContactType: contact.organization_name ? "COMPANY" as const : "PERSON" as const,
    ...(contact.organization_name ? { OrganizationName: contact.organization_name } : {}),
  };
}

export async function transferDomain(
  domain: string,
  authCode: string,
  contact: DomainContactInfo,
  durationYears = 1,
  autoRenew = true,
  config?: Route53Config,
  options: Route53RegistrarOptions = {},
): Promise<{ operationId: string }> {
  const { domains } = makeClients(config);
  const contactDetail = contactToRoute53Contact(contact);

  const result = await domains.send(
    new TransferDomainCommand({
      DomainName: domain,
      AuthCode: authCode,
      DurationInYears: durationYears,
      AutoRenew: autoRenew,
      AdminContact: contactDetail,
      RegistrantContact: contactDetail,
      TechContact: contactDetail,
      PrivacyProtectAdminContact: options.privacy_protected ?? true,
      PrivacyProtectRegistrantContact: options.privacy_protected ?? true,
      PrivacyProtectTechContact: options.privacy_protected ?? true,
      ...(options.nameservers?.length
        ? { Nameservers: options.nameservers.map((Name) => ({ Name })) }
        : {}),
    }),
  );

  return { operationId: result.OperationId ?? "" };
}

export async function getRegistrationStatus(
  operationId: string,
  config?: Route53Config,
): Promise<Route53OperationStatus> {
  const { domains } = makeClients(config);
  const result = await domains.send(
    new GetOperationDetailCommand({ OperationId: operationId }),
  );
  return {
    status: result.Status ?? "UNKNOWN",
    domain: result.DomainName,
    message: result.Message,
  };
}

export interface DomainDetail {
  domain: string;
  expiry: string;
  auto_renew: boolean | null;
  transfer_lock: boolean | null;
  created: string;
  updated: string;
  nameservers: string[];
  status_list: string[];
  registrar_name?: string;
  privacy_protected: boolean | null;
}

export async function getDomainDetail(domain: string, config?: Route53Config): Promise<DomainDetail> {
  const { domains } = makeClients(config);
  const [result, summary] = await Promise.all([
    domains.send(new GetDomainDetailCommand({ DomainName: domain })),
    getDomainSummary(domain, config),
  ]);
  const privacy = result as {
    AdminPrivacy?: boolean;
    RegistrantPrivacy?: boolean;
    TechPrivacy?: boolean;
  };
  return {
    domain: result.DomainName ?? domain,
    expiry: result.ExpirationDate?.toISOString() ?? summary?.expiry ?? "",
    auto_renew: result.AutoRenew ?? summary?.auto_renew ?? null,
    transfer_lock:
      summary?.transfer_lock ??
      (result.StatusList?.includes("TRANSFER_LOCK") ? true : null),
    created: result.CreationDate?.toISOString() ?? "",
    updated: result.UpdatedDate?.toISOString() ?? "",
    nameservers: (result.Nameservers ?? []).map((ns) => ns.Name ?? "").filter(Boolean),
    status_list: result.StatusList ?? [],
    registrar_name: result.RegistrarName,
    privacy_protected:
      privacy.RegistrantPrivacy ??
      privacy.AdminPrivacy ??
      privacy.TechPrivacy ??
      null,
  };
}

async function getDomainSummary(
  domain: string,
  config?: Route53Config,
): Promise<RegisteredDomain | null> {
  let marker: string | undefined;

  do {
    const { domains } = makeClients(config);
    const result = await domains.send(
      new ListDomainsCommand({ Marker: marker, MaxItems: 100 }),
    );
    const summary = (result.Domains ?? []).find((item) => item.DomainName === domain);
    if (summary) {
      return {
        domain: summary.DomainName ?? domain,
        expiry: summary.Expiry?.toISOString() ?? "",
        auto_renew: summary.AutoRenew ?? false,
        transfer_lock: summary.TransferLock ?? false,
      };
    }
    marker = result.NextPageMarker;
  } while (marker);

  return null;
}

export async function requestTransferOutAuthCode(
  domain: string,
  config?: Route53Config,
): Promise<Route53TransferOutAuthCode> {
  const { domains } = makeClients(config);
  const detail = await getDomainDetail(domain, config);
  let transferLockDisabled = false;
  let transferLockOperationId: string | null = null;

  if (detail.transfer_lock) {
    const result = await domains.send(
      new DisableDomainTransferLockCommand({ DomainName: domain }),
    );
    transferLockDisabled = true;
    transferLockOperationId = result.OperationId ?? null;
  }

  const authCodeResult = await domains.send(
    new RetrieveDomainAuthCodeCommand({ DomainName: domain }),
  );
  if (!authCodeResult.AuthCode) {
    throw new Error("Route53 did not return a domain transfer authorization code");
  }

  return {
    auth_code: authCodeResult.AuthCode,
    transfer_lock_disabled: transferLockDisabled,
    transfer_lock_operation_id: transferLockOperationId,
  };
}

/** Minimal Route53 Domains client surface — lets tests inject a fake `send`. */
type Route53DomainsSend = { send: (cmd: unknown) => Promise<{ OperationId?: string }> };

/**
 * Point a domain's nameservers at a new set (the Cloudflare zone NS).
 *
 * Point a Route 53-registered domain at the chosen DNS provider's nameservers.
 * Returns the async operation id (poll getOperationDetail).
 */
export async function updateNameservers(
  domain: string,
  nameservers: string[],
  config?: Route53Config,
  client?: Route53DomainsSend,
): Promise<{ operationId: string }> {
  if (!nameservers.length) {
    throw new Error("updateNameservers requires at least one nameserver");
  }
  const domains = client ?? makeClients(config).domains;
  const result = await domains.send(
    new UpdateDomainNameserversCommand({
      DomainName: domain,
      Nameservers: nameservers.map((name) => ({ Name: name })),
    }),
  );
  return { operationId: result.OperationId ?? "" };
}

export async function listRegisteredDomains(config?: Route53Config): Promise<RegisteredDomain[]> {
  const { domains } = makeClients(config);
  const all: RegisteredDomain[] = [];
  let nextPageMarker: string | undefined;

  do {
    const result = await domains.send(new ListDomainsCommand({ Marker: nextPageMarker }));
    for (const d of result.Domains ?? []) {
      all.push({
        domain: d.DomainName ?? "",
        expiry: d.Expiry?.toISOString() ?? "",
        auto_renew: d.AutoRenew ?? false,
        transfer_lock: d.TransferLock ?? false,
      });
    }
    nextPageMarker = result.NextPageMarker;
  } while (nextPageMarker);

  return all;
}

// ─── Hosted Zones ────────────────────────────────────────────────────────────

function cleanZoneId(id: string): string {
  return id.replace("/hostedzone/", "");
}

// Normalize user-provided zone IDs — strip the "/hostedzone/" prefix if pasted from the console
function normalizeZoneId(id: string): string {
  return cleanZoneId(id.trim());
}

function normalizeNameserver(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function nameserversMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...new Set(a.map(normalizeNameserver))].sort();
  const right = [...new Set(b.map(normalizeNameserver))].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cleanChangeId(id?: string): string | null {
  return id?.replace("/change/", "") || null;
}

export async function createHostedZone(
  domain: string,
  comment?: string,
  config?: Route53Config,
  options?: { callerReference?: string },
): Promise<HostedZoneInfo> {
  const { route53 } = makeClients(config);
  const callerRef = options?.callerReference ?? `domains-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const result = await route53.send(
    new CreateHostedZoneCommand({
      Name: domain,
      CallerReference: callerRef,
      HostedZoneConfig: comment ? { Comment: comment } : undefined,
    }),
  );

  return {
    id: cleanZoneId(result.HostedZone?.Id ?? ""),
    name: result.HostedZone?.Name ?? domain,
    record_count: result.HostedZone?.ResourceRecordSetCount ?? 0,
    comment,
    name_servers: result.DelegationSet?.NameServers ?? [],
  };
}

export async function listHostedZones(config?: Route53Config): Promise<HostedZoneInfo[]> {
  const { route53 } = makeClients(config);
  const zones: HostedZoneInfo[] = [];
  let marker: string | undefined;

  do {
    const result = await route53.send(new ListHostedZonesCommand({ Marker: marker }));
    for (const z of result.HostedZones ?? []) {
      zones.push({
        id: cleanZoneId(z.Id ?? ""),
        name: z.Name ?? "",
        record_count: z.ResourceRecordSetCount ?? 0,
        comment: z.Config?.Comment,
        private_zone: z.Config?.PrivateZone,
      });
    }
    marker = result.IsTruncated ? result.NextMarker : undefined;
  } while (marker);

  return zones;
}

export async function getHostedZone(
  hostedZoneId: string,
  config?: Route53Config,
): Promise<HostedZoneInfo & { name_servers: string[] }> {
  const { route53 } = makeClients(config);
  const result = await route53.send(
    new GetHostedZoneCommand({ Id: normalizeZoneId(hostedZoneId) }),
  );
  return {
    id: cleanZoneId(result.HostedZone?.Id ?? ""),
    name: result.HostedZone?.Name ?? "",
    record_count: result.HostedZone?.ResourceRecordSetCount ?? 0,
    comment: result.HostedZone?.Config?.Comment,
    name_servers: result.DelegationSet?.NameServers ?? [],
    private_zone: result.HostedZone?.Config?.PrivateZone,
  };
}

export async function deleteHostedZone(hostedZoneId: string, config?: Route53Config): Promise<void> {
  const { route53 } = makeClients(config);
  const zoneId = normalizeZoneId(hostedZoneId);
  const managedRecords: ResourceRecordSet[] = [];
  let nextName: string | undefined;
  let nextType: ResourceRecordSet["Type"] | undefined;
  let nextIdentifier: string | undefined;

  do {
    const result = await route53.send(
      new ListResourceRecordSetsCommand({
        HostedZoneId: zoneId,
        StartRecordName: nextName,
        StartRecordType: nextType,
        StartRecordIdentifier: nextIdentifier,
      }),
    );
    managedRecords.push(
      ...(result.ResourceRecordSets?.filter(
        (record) => record.Type !== "NS" && record.Type !== "SOA",
      ) ?? []),
    );
    nextName = result.IsTruncated ? result.NextRecordName : undefined;
    nextType = result.IsTruncated
      ? (result.NextRecordType as ResourceRecordSet["Type"] | undefined)
      : undefined;
    nextIdentifier = result.IsTruncated ? result.NextRecordIdentifier : undefined;
  } while (nextName && nextType);

  for (let index = 0; index < managedRecords.length; index += 100) {
    const batch = managedRecords.slice(index, index + 100);
    if (batch.length === 0) continue;
    await route53.send(
      new ChangeResourceRecordSetsCommand({
        HostedZoneId: zoneId,
        ChangeBatch: {
          Changes: batch.map((record) => ({
            Action: "DELETE",
            ResourceRecordSet: record,
          })),
        },
      }),
    );
  }

  await route53.send(new DeleteHostedZoneCommand({ Id: zoneId }));
}

export async function findHostedZoneByDomain(domain: string, config?: Route53Config): Promise<HostedZoneInfo | null> {
  const zones = await listHostedZones(config);
  const normalized = domain.endsWith(".") ? domain : `${domain}.`;
  const matches = zones.filter((z) => z.name === normalized);
  if (matches.length === 0) return null;
  const publicMatches = matches.filter((z) => !z.private_zone);
  const candidates = publicMatches.length > 0 ? publicMatches : matches;
  if (candidates.length > 1) {
    throw new Error(`Multiple Route 53 hosted zones found for ${domain}; specify hosted zone id`);
  }
  return candidates[0] ?? null;
}

export async function findHostedZoneByNameservers(
  domain: string,
  nameservers: string[],
  config?: Route53Config,
): Promise<HostedZoneInfo | null> {
  if (!nameservers.length) return null;
  const { route53 } = makeClients(config);
  const result = await route53.send(
    new ListHostedZonesByNameCommand({ DNSName: domain }),
  );
  const zones = (result.HostedZones ?? []).filter(
    (zone) => zone.Name?.replace(/\.$/, "") === domain && !zone.Config?.PrivateZone,
  );

  for (const zone of zones) {
    const id = cleanZoneId(zone.Id ?? "");
    if (!id) continue;
    const detail = await getHostedZone(id, config);
    const delegatedNameservers = detail.name_servers ?? [];
    if (nameserversMatch(delegatedNameservers, nameservers)) {
      return { ...detail, id, name_servers: delegatedNameservers };
    }
  }

  return null;
}

// ─── DNS Records ─────────────────────────────────────────────────────────────

function rrsToRecord(rrs: ResourceRecordSet): Route53Record {
  if (rrs.AliasTarget) {
    return {
      name: rrs.Name ?? "",
      type: rrs.Type ?? "",
      ttl: 0,
      values: [],
      alias_target: {
        hosted_zone_id: rrs.AliasTarget.HostedZoneId ?? "",
        dns_name: rrs.AliasTarget.DNSName ?? "",
      },
    };
  }
  return {
    name: rrs.Name ?? "",
    type: rrs.Type ?? "",
    ttl: rrs.TTL ?? 0,
    values: (rrs.ResourceRecords ?? []).map((r) => r.Value ?? ""),
  };
}

function recordToRrs(record: Route53RecordInput): ResourceRecordSet {
  if (record.alias_target) {
    return {
      Name: record.name,
      Type: record.type as ResourceRecordSet["Type"],
      AliasTarget: {
        HostedZoneId: record.alias_target.hosted_zone_id,
        DNSName: record.alias_target.dns_name,
        EvaluateTargetHealth: false,
      },
    };
  }
  return {
    Name: record.name,
    Type: record.type as ResourceRecordSet["Type"],
    TTL: record.ttl ?? 300,
    ResourceRecords: record.values.map((v) => ({ Value: v })),
  };
}

export async function listRecords(hostedZoneId: string, config?: Route53Config): Promise<Route53Record[]> {
  const { route53 } = makeClients(config);
  const records: Route53Record[] = [];
  let nextName: string | undefined;
  let nextType: string | undefined;

  do {
    const result = await route53.send(
      new ListResourceRecordSetsCommand({
        HostedZoneId: normalizeZoneId(hostedZoneId),
        StartRecordName: nextName,
        StartRecordType: nextType as ResourceRecordSet["Type"] | undefined,
      }),
    );
    for (const rrs of result.ResourceRecordSets ?? []) {
      records.push(rrsToRecord(rrs));
    }
    if (result.IsTruncated) {
      nextName = result.NextRecordName;
      nextType = result.NextRecordType;
    } else {
      nextName = undefined;
      nextType = undefined;
    }
  } while (nextName);

  return records;
}

export async function upsertRecord(
  hostedZoneId: string,
  record: Route53RecordInput,
  config?: Route53Config,
  options?: Route53ChangeOptions,
): Promise<Route53ChangeResult> {
  const { route53 } = makeClients(config);
  const result = await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: normalizeZoneId(hostedZoneId),
      ChangeBatch: {
        ...(options?.comment ? { Comment: options.comment } : {}),
        Changes: [{ Action: "UPSERT", ResourceRecordSet: recordToRrs(record) }],
      },
    }),
  );
  return { changeId: cleanChangeId(result.ChangeInfo?.Id) };
}

export async function deleteRecord(
  hostedZoneId: string,
  record: Route53RecordInput,
  config?: Route53Config,
  options?: Route53ChangeOptions,
): Promise<Route53ChangeResult> {
  const { route53 } = makeClients(config);
  const result = await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: normalizeZoneId(hostedZoneId),
      ChangeBatch: {
        ...(options?.comment ? { Comment: options.comment } : {}),
        Changes: [{ Action: "DELETE", ResourceRecordSet: recordToRrs(record) }],
      },
    }),
  );
  return { changeId: cleanChangeId(result.ChangeInfo?.Id) };
}

export async function upsertRecords(
  hostedZoneId: string,
  records: Route53RecordInput[],
  config?: Route53Config,
  options?: Route53ChangeOptions,
): Promise<Route53ChangeResult> {
  if (records.length === 0) return { changeId: null };
  const { route53 } = makeClients(config);
  const changes = records.map((r) => ({
    Action: "UPSERT" as const,
    ResourceRecordSet: recordToRrs(r),
  }));
  const result = await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: normalizeZoneId(hostedZoneId),
      ChangeBatch: {
        ...(options?.comment ? { Comment: options.comment } : {}),
        Changes: changes,
      },
    }),
  );
  return { changeId: cleanChangeId(result.ChangeInfo?.Id) };
}

// ─── RegistrarProvider Adapter ───────────────────────────────────────────────

export function createRoute53Provider(config?: Route53Config): FullProvider {
  const cfg = config ?? getConfig();
  const registerWithRoute53 = registerDomain;
  const updateRoute53Nameservers = updateNameservers;

  async function listDomainInventory(): Promise<ProviderDomainInfo[]> {
    const byDomain = new Map<string, ProviderDomainInfo>();

    try {
      const registered = await listRegisteredDomains(cfg);
      for (const d of registered) {
        byDomain.set(d.domain, {
          domain: d.domain,
          registrar: "AWS Route 53",
          created: "",
          expires: d.expiry,
          nameservers: [],
          status: "active",
          auto_renew: d.auto_renew,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("route53domains:ListDomains") && !message.includes("AccessDenied")) {
        throw error;
      }
    }

    const zones = await listHostedZones(cfg);
    for (const z of zones) {
      const zone = z.name_servers?.length ? z : await getHostedZone(z.id, cfg).catch(() => z);
      const domain = zone.name.replace(/\.$/, "");
      const nameservers = zone.name_servers ?? [];
      const existing = byDomain.get(domain);
      if (existing) {
        existing.nameservers = nameservers.length > 0 ? nameservers : existing.nameservers;
        continue;
      }
      byDomain.set(domain, {
        domain,
        registrar: "AWS Route 53 DNS",
        created: "",
        expires: "",
        nameservers,
        status: "active",
        auto_renew: false,
      });
    }

    return Array.from(byDomain.values());
  }

  return {
    name: "route53",

    async listDomains(): Promise<ProviderDomainInfo[]> {
      return listDomainInventory();
    },

    async getDomainInfo(domain: string): Promise<ProviderDomainInfo> {
      const detail = await getDomainDetail(domain, cfg);
      return {
        domain: detail.domain,
        registrar: "AWS Route 53",
        created: detail.created,
        expires: detail.expiry,
        nameservers: detail.nameservers,
        status: "active",
        auto_renew: detail.auto_renew ?? false,
      };
    },

    async registerDomain(domain, contact, options = {}) {
      const result = await registerWithRoute53(
        domain,
        contact,
        options.years ?? 1,
        options.autoRenew ?? true,
        cfg,
      );
      return { domain, success: !!result.operationId, operationId: result.operationId };
    },

    async updateNameservers(domain, nameservers) {
      const result = await updateRoute53Nameservers(domain, nameservers, cfg);
      return { domain, success: !!result.operationId, operationId: result.operationId };
    },

    async renewDomain(_domain: string): Promise<ProviderRenewResult> {
      // Route 53 domains auto-renew; manual renewal isn't exposed the same way
      return { domain: _domain, success: false, orderId: undefined, chargedAmount: undefined };
    },

    async getDnsRecords(domain: string): Promise<ProviderDnsRecord[]> {
      const zone = await findHostedZoneByDomain(domain, cfg);
      if (!zone) return [];
      const records = await listRecords(zone.id, cfg);
      // Expand multi-value record sets into individual ProviderDnsRecords
      const result: ProviderDnsRecord[] = [];
      for (const r of records) {
        if (r.alias_target) {
          result.push({ type: r.type, name: r.name, value: r.alias_target.dns_name, ttl: 0 });
        } else {
          for (const v of r.values) {
            result.push({ type: r.type, name: r.name, value: v, ttl: r.ttl });
          }
        }
      }
      return result;
    },

    async setDnsRecords(domain: string, records: ProviderDnsRecord[]): Promise<boolean> {
      const zone = await findHostedZoneByDomain(domain, cfg);
      if (!zone) throw new Error(`No hosted zone found for ${domain}`);
      // Group by name+type to reassemble multi-value record sets
      const grouped = new Map<string, { name: string; type: string; ttl: number; values: string[] }>();
      for (const r of records) {
        const key = `${r.name}|${r.type}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.values.push(r.value);
        } else {
          grouped.set(key, { name: r.name, type: r.type, ttl: r.ttl, values: [r.value] });
        }
      }
      await upsertRecords(zone.id, Array.from(grouped.values()), cfg);
      return true;
    },

    async checkAvailability(domain: string): Promise<ProviderAvailability> {
      const result = await checkAvailability(domain, cfg);
      return {
        domain: result.domain,
        available: result.available,
        standard_price: result.price ? Number(result.price) : undefined,
        currency: result.currency,
      };
    },

    async syncToLocalDb(dbFns: DbFunctions): Promise<ProviderSyncResult> {
      const domains = await listDomainInventory();
      let synced = 0;
      let created = 0;
      let updated = 0;
      const errors: string[] = [];

      for (const d of domains) {
        try {
          const existing = await dbFns.getDomainByName(d.domain);
          if (existing) {
            const existingRoute53 = existing.metadata["route53"] as { source?: string } | undefined;
            const staleDnsOnlyRegistrar = d.registrar !== "AWS Route 53"
              && (existing.registrar === "AWS Route 53 DNS"
                || (existing.registrar === "AWS Route 53" && existingRoute53?.source === "route53:hosted_zones"));
            await dbFns.updateDomain(existing.id, {
              ...(d.registrar === "AWS Route 53" ? { registrar: "AWS Route 53" } : {}),
              ...(staleDnsOnlyRegistrar ? { registrar: null } : {}),
              expires_at: d.expires || undefined,
              auto_renew: d.auto_renew,
              nameservers: d.nameservers.length > 0 ? d.nameservers : existing.nameservers,
              metadata: {
                ...existing.metadata,
                route53: {
                  source: d.registrar === "AWS Route 53" ? "route53domains+hosted_zones" : "route53:hosted_zones",
                  synced_at: new Date().toISOString(),
                },
              },
              status: "active",
            });
            updated++;
          } else {
            await dbFns.createDomain({
              name: d.domain,
              ...(d.registrar === "AWS Route 53" ? { registrar: "AWS Route 53" } : {}),
              expires_at: d.expires || undefined,
              auto_renew: d.auto_renew,
              nameservers: d.nameservers,
              status: "active",
              notes: d.registrar === "AWS Route 53 DNS" ? "Discovered from Route 53 hosted zones; registrar ownership was not inferred." : undefined,
              metadata: {
                route53: {
                  source: d.registrar === "AWS Route 53" ? "route53domains+hosted_zones" : "route53:hosted_zones",
                  synced_at: new Date().toISOString(),
                },
              },
            });
            created++;
          }
          synced++;
        } catch (err) {
          errors.push(`${d.domain}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return { synced, created, updated, errors };
    },
  };
}

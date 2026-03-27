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
  type ResourceRecordSet,
} from "@aws-sdk/client-route-53";
import {
  Route53DomainsClient,
  CheckDomainAvailabilityCommand,
  RegisterDomainCommand,
  GetOperationDetailCommand,
  GetDomainDetailCommand,
  ListDomainsCommand,
  ListPricesCommand,
  type CountryCode,
} from "@aws-sdk/client-route-53-domains";
import type {
  RegistrarProvider,
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
}

export interface DomainContactInfo {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line_1: string;
  city: string;
  state: string;
  country_code: string;
  zip_code: string;
  organization_name?: string;
}

export interface DomainAvailability {
  domain: string;
  available: boolean;
  price?: string;
  currency?: string;
}

export interface RegisteredDomain {
  domain: string;
  expiry: string;
  auto_renew: boolean;
  transfer_lock: boolean;
}

export interface HostedZoneInfo {
  id: string;
  name: string;
  record_count: number;
  comment?: string;
  name_servers?: string[];
}

export interface Route53Record {
  name: string;
  type: string;
  ttl: number;
  values: string[];
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

// ─── Config ──────────────────────────────────────────────────────────────────

export function getConfig(): Route53Config {
  return {
    region: process.env["AWS_REGION"] || "us-east-1",
    accessKeyId: process.env["AWS_ACCESS_KEY_ID"],
    secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"],
  };
}

function checkCredentials(cfg: Route53Config): void {
  // When explicit keys are provided in config, always accept them.
  if (cfg.accessKeyId && cfg.secretAccessKey) return;
  // Otherwise fall back to env vars — if neither source has both keys, fail early.
  const hasEnv = !!(process.env["AWS_ACCESS_KEY_ID"] && process.env["AWS_SECRET_ACCESS_KEY"]);
  const hasProfile = !!process.env["AWS_PROFILE"];
  if (!hasEnv && !hasProfile) {
    throw new Error(
      "AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (or AWS_PROFILE) environment variables.",
    );
  }
}

function makeClients(config?: Route53Config) {
  const cfg = config ?? getConfig();
  checkCredentials(cfg);
  const region = cfg.region || "us-east-1";
  const credentials = cfg.accessKeyId && cfg.secretAccessKey
    ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
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
  };

  try {
    const tld = domain.split(".").slice(1).join(".");
    const prices = await domains.send(new ListPricesCommand({ Tld: tld, MaxItems: 1 }));
    const price = prices.Prices?.[0];
    if (price?.RegistrationPrice) {
      availability.price = price.RegistrationPrice.Price?.toString();
      availability.currency = price.RegistrationPrice.Currency;
    }
  } catch {
    // Pricing not critical
  }

  return availability;
}

export async function registerDomain(
  domain: string,
  contact: DomainContactInfo,
  durationYears = 1,
  autoRenew = true,
  config?: Route53Config,
): Promise<{ operationId: string }> {
  const { domains } = makeClients(config);

  const contactDetail = {
    FirstName: contact.first_name,
    LastName: contact.last_name,
    Email: contact.email,
    PhoneNumber: contact.phone,
    AddressLine1: contact.address_line_1,
    City: contact.city,
    State: contact.state,
    CountryCode: contact.country_code as CountryCode,
    ZipCode: contact.zip_code,
    ContactType: contact.organization_name ? "COMPANY" as const : "PERSON" as const,
    ...(contact.organization_name ? { OrganizationName: contact.organization_name } : {}),
  };

  const result = await domains.send(
    new RegisterDomainCommand({
      DomainName: domain,
      DurationInYears: durationYears,
      AutoRenew: autoRenew,
      AdminContact: contactDetail,
      RegistrantContact: contactDetail,
      TechContact: contactDetail,
      PrivacyProtectAdminContact: true,
      PrivacyProtectRegistrantContact: true,
      PrivacyProtectTechContact: true,
    }),
  );

  return { operationId: result.OperationId ?? "" };
}

export async function getRegistrationStatus(
  operationId: string,
  config?: Route53Config,
): Promise<{ status: string; domain?: string; message?: string }> {
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

export interface DomainDetail extends RegisteredDomain {
  created: string;
  nameservers: string[];
}

export async function getDomainDetail(domain: string, config?: Route53Config): Promise<DomainDetail> {
  const { domains } = makeClients(config);
  const result = await domains.send(new GetDomainDetailCommand({ DomainName: domain }));
  return {
    domain: result.DomainName ?? domain,
    expiry: result.ExpirationDate?.toISOString() ?? "",
    auto_renew: result.AutoRenew ?? false,
    transfer_lock: result.StatusList?.includes("TRANSFER_LOCK") ?? false,
    created: result.CreationDate?.toISOString() ?? "",
    nameservers: (result.Nameservers ?? []).map((ns) => ns.Name ?? "").filter(Boolean),
  };
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

export async function createHostedZone(
  domain: string,
  comment?: string,
  config?: Route53Config,
): Promise<HostedZoneInfo> {
  const { route53 } = makeClients(config);
  const callerRef = `domains-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
  };
}

export async function deleteHostedZone(hostedZoneId: string, config?: Route53Config): Promise<void> {
  const { route53 } = makeClients(config);
  await route53.send(new DeleteHostedZoneCommand({ Id: normalizeZoneId(hostedZoneId) }));
}

export async function findHostedZoneByDomain(domain: string, config?: Route53Config): Promise<HostedZoneInfo | null> {
  const zones = await listHostedZones(config);
  const normalized = domain.endsWith(".") ? domain : `${domain}.`;
  return zones.find((z) => z.name === normalized) ?? null;
}

// ─── DNS Records ─────────────────────────────────────────────────────────────

function rrsToRecord(rrs: ResourceRecordSet): Route53Record {
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
): Promise<void> {
  const { route53 } = makeClients(config);
  await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: normalizeZoneId(hostedZoneId),
      ChangeBatch: {
        Changes: [{ Action: "UPSERT", ResourceRecordSet: recordToRrs(record) }],
      },
    }),
  );
}

export async function deleteRecord(
  hostedZoneId: string,
  record: Route53RecordInput,
  config?: Route53Config,
): Promise<void> {
  const { route53 } = makeClients(config);
  await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: normalizeZoneId(hostedZoneId),
      ChangeBatch: {
        Changes: [{ Action: "DELETE", ResourceRecordSet: recordToRrs(record) }],
      },
    }),
  );
}

export async function upsertRecords(
  hostedZoneId: string,
  records: Route53RecordInput[],
  config?: Route53Config,
): Promise<void> {
  if (records.length === 0) return;
  const { route53 } = makeClients(config);
  const changes = records.map((r) => ({
    Action: "UPSERT" as const,
    ResourceRecordSet: recordToRrs(r),
  }));
  await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: normalizeZoneId(hostedZoneId),
      ChangeBatch: { Changes: changes },
    }),
  );
}

// ─── RegistrarProvider Adapter ───────────────────────────────────────────────

export function createRoute53Provider(config?: Route53Config): RegistrarProvider {
  const cfg = config ?? getConfig();

  return {
    name: "route53",

    async listDomains(): Promise<ProviderDomainInfo[]> {
      const domains = await listRegisteredDomains(cfg);
      return domains.map((d) => ({
        domain: d.domain,
        registrar: "AWS Route 53",
        created: "",
        expires: d.expiry,
        nameservers: [],
        status: "active",
        auto_renew: d.auto_renew,
      }));
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
        auto_renew: detail.auto_renew,
      };
    },

    async renewDomain(_domain: string): Promise<ProviderRenewResult> {
      // Route 53 domains auto-renew; manual renewal isn't exposed the same way
      return { domain: _domain, success: false, orderId: undefined, chargedAmount: undefined };
    },

    async getDnsRecords(domain: string): Promise<ProviderDnsRecord[]> {
      const zone = await findHostedZoneByDomain(domain, cfg);
      if (!zone) return [];
      const records = await listRecords(zone.id, cfg);
      return records.map((r) => ({
        type: r.type,
        name: r.name,
        value: r.values.join(", "),
        ttl: r.ttl,
      }));
    },

    async setDnsRecords(domain: string, records: ProviderDnsRecord[]): Promise<boolean> {
      const zone = await findHostedZoneByDomain(domain, cfg);
      if (!zone) throw new Error(`No hosted zone found for ${domain}`);
      const r53Records = records.map((r) => ({
        name: r.name,
        type: r.type,
        ttl: r.ttl,
        values: [r.value],
      }));
      await upsertRecords(zone.id, r53Records, cfg);
      return true;
    },

    async checkAvailability(domain: string): Promise<ProviderAvailability> {
      const result = await checkAvailability(domain, cfg);
      return { domain: result.domain, available: result.available };
    },

    async syncToLocalDb(dbFns: DbFunctions): Promise<ProviderSyncResult> {
      const domains = await listRegisteredDomains(cfg);
      let synced = 0;
      let created = 0;
      let updated = 0;
      const errors: string[] = [];

      for (const d of domains) {
        try {
          const existing = dbFns.getDomainByName(d.domain);
          if (existing) {
            dbFns.updateDomain(existing.id, {
              registrar: "AWS Route 53",
              expires_at: d.expiry || undefined,
              auto_renew: d.auto_renew,
              status: "active",
            });
            updated++;
          } else {
            dbFns.createDomain({
              name: d.domain,
              registrar: "AWS Route 53",
              expires_at: d.expiry || undefined,
              auto_renew: d.auto_renew,
              status: "active",
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

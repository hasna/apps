import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import {
  checkAvailability,
  deleteDefaultHostedZone,
  getDomainDetail,
  listHostedZonesByDomain,
  getRegistrationContactFromDomain,
  getRegistrationStatus,
  registerDomain,
  updateNameservers,
  createRoute53Provider,
} from "../lib/route53.js";
import {
  createBrandsightProvider,
  resolveBrandsightConfig,
} from "../lib/brandsight.js";
import {
  bindWorkerCustomDomain,
  boundedResponseText,
  ensureZone,
  ensureZoneOriginTlsMode,
  getZone,
  getZoneOriginTlsMode,
  listRecords,
  reconcileRecords,
  deleteRecordByNameType,
  upsertRecord,
  workerCustomDomainReady,
  type CloudflareConfig,
} from "../lib/cloudflare.js";
import type { ProviderDnsRecord } from "../lib/registrar.js";
import {
  RegistrarActionRequiredError,
  type DomainProvisioningProviders,
  type ProvisioningRegistrar,
} from "../lib/provisioning.js";

function sourceDomain(env: NodeJS.ProcessEnv): string {
  const value = env["DOMAINS_REGISTRANT_SOURCE_DOMAIN"]?.trim();
  if (!value) throw new Error("DOMAINS_REGISTRANT_SOURCE_DOMAIN is required for hosted domain purchases");
  return value;
}

function hostedCloudflareConfig(env: NodeJS.ProcessEnv): CloudflareConfig {
  const apiToken = env["CLOUDFLARE_API_TOKEN"]?.trim();
  const accountId = env["CLOUDFLARE_ACCOUNT_ID"]?.trim();
  if (!apiToken) {
    if (env["CLOUDFLARE_API_KEY"] || env["CLOUDFLARE_EMAIL"]) {
      throw new Error("hosted provisioning requires CLOUDFLARE_API_TOKEN; global API key/email authentication is not accepted");
    }
    throw new Error("CLOUDFLARE_API_TOKEN is required for hosted provisioning");
  }
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is required for hosted provisioning");
  return { apiToken, accountId };
}

function nameserversEqual(left: string[], right: string[]): boolean {
  const norm = (items: string[]) => [...new Set(items.map((item) => item.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean))].sort();
  return JSON.stringify(norm(left)) === JSON.stringify(norm(right));
}

const PRESERVABLE_DNS_TYPES = new Set([
  "A", "AAAA", "CAA", "CNAME", "MX", "NS", "TXT",
]);

interface CanonicalDelegationRecord {
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
}

function delegationRecordName(value: string, hostname: string): string {
  const raw = value.trim().toLowerCase().replace(/\.$/u, "");
  const name = raw === "@" || raw === ""
    ? hostname
    : raw === hostname || raw.endsWith(`.${hostname}`)
      ? raw
      : `${raw}.${hostname}`;
  if (
    name.length > 253
    || !/^(?:\*\.)?[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*$/u.test(name)
    || (name !== hostname && !name.endsWith(`.${hostname}`))
  ) {
    throw new RegistrarActionRequiredError("registrar DNS contains a record outside the adopted domain");
  }
  return name;
}

function delegationRecordValue(type: string, value: unknown, hostname: string): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 8_192 || /[\0\r\n]/u.test(raw)) {
    throw new RegistrarActionRequiredError("registrar DNS contains an invalid record value");
  }
  if (!["CNAME", "MX", "NS"].includes(type)) return raw;
  const target = raw.toLowerCase().replace(/\.$/u, "");
  return target.includes(".") ? target : `${target}.${hostname}`;
}

export function canonicalDelegationRecords(
  records: ProviderDnsRecord[],
  hostname: string,
): CanonicalDelegationRecord[] {
  if (records.length > 500) {
    throw new RegistrarActionRequiredError("registrar DNS has more than 500 records; automatic preservation is refused");
  }
  const canonical: CanonicalDelegationRecord[] = [];
  for (const record of records) {
    const type = String(record.type ?? "").trim().toUpperCase();
    const name = delegationRecordName(String(record.name ?? ""), hostname);
    if (type === "SOA" || (type === "NS" && name === hostname)) continue;
    if (!PRESERVABLE_DNS_TYPES.has(type)) {
      throw new RegistrarActionRequiredError(`registrar DNS record type '${type}' cannot be preserved automatically`);
    }
    const value = delegationRecordValue(type, record.value, hostname);
    const ttl = Number(record.ttl);
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86_400) {
      throw new RegistrarActionRequiredError("registrar DNS contains a TTL outside 60-86400 seconds");
    }
    const priority = record.priority === undefined || record.priority === null
      ? null
      : Number(record.priority);
    if (priority !== null && (!Number.isInteger(priority) || priority < 0 || priority > 65_535)) {
      throw new RegistrarActionRequiredError("registrar DNS contains an invalid priority");
    }
    canonical.push({ type, name, value, ttl, priority });
  }
  canonical.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (new Set(canonical.map((record) => JSON.stringify(record))).size !== canonical.length) {
    throw new RegistrarActionRequiredError("registrar DNS contains duplicate records");
  }
  return canonical;
}

function delegationRecordHash(records: CanonicalDelegationRecord[]): string {
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

export function createHostedProvisioningProviders(
  env: NodeJS.ProcessEnv = process.env,
): DomainProvisioningProviders {
  const cloudflareConfig = hostedCloudflareConfig(env);
  const registrantSourceDomain = sourceDomain(env);
  const brandsightConfig = resolveBrandsightConfig(env);
  const brandsight = brandsightConfig.apiKey
    && brandsightConfig.apiSecret
    && brandsightConfig.customerId
    ? createBrandsightProvider(brandsightConfig)
    : null;
  const route53 = createRoute53Provider();
  const requireBrandsight = () => {
    if (!brandsight) {
      throw new RegistrarActionRequiredError(
        "Brandsight ownership or delegation requires the existing BRANDSIGHT_API_KEY, BRANDSIGHT_API_SECRET, and BRANDSIGHT_CUSTOMER_ID credential references",
      );
    }
    return brandsight;
  };
  return {
    async checkAvailability(name) {
      const availability = await checkAvailability(name);
      return {
        available: availability.available,
        ...(availability.price !== undefined ? { price_usd: Number(availability.price) } : {}),
        ...(availability.price !== undefined
          ? { registration_price_usd: Number(availability.price) }
          : {}),
        ...(availability.renewal_price !== undefined
          ? { renewal_price_usd: Number(availability.renewal_price) }
          : {}),
        ...(availability.currency ? { currency: availability.currency } : {}),
      };
    },

    async submitRegistration(input) {
      const contact = await getRegistrationContactFromDomain(registrantSourceDomain);
      return registerDomain(
        input.name,
        contact,
        input.years,
        input.autoRenew,
        undefined,
        { privacy_protected: true },
      );
    },

    getOperationStatus(operationId) {
      return getRegistrationStatus(operationId);
    },

    async getDomainDetail(name, registrar: ProvisioningRegistrar = "route53") {
      if (registrar === "brandsight") {
        try {
          const detail = await requireBrandsight().getDomainInfo(name);
          if (detail.domain.toLowerCase().replace(/\.$/u, "") !== name) {
            throw new RegistrarActionRequiredError(
              "Brandsight ownership readback returned a different domain",
            );
          }
          return {
            registered_at: detail.created || undefined,
            expires_at: detail.expires || undefined,
            auto_renew: detail.auto_renew,
            nameservers: detail.nameservers,
            registrar: "Brandsight",
          };
        } catch (error) {
          if (error instanceof RegistrarActionRequiredError) throw error;
          const message = error instanceof Error ? error.message : String(error);
          if (/not found|not registered|404/i.test(message)) return null;
          throw error;
        }
      }
      try {
        const detail = await getDomainDetail(name);
        return {
          registered_at: detail.created || undefined,
          expires_at: detail.expiry || undefined,
          auto_renew: detail.auto_renew ?? undefined,
          nameservers: detail.nameservers,
          registrar: detail.registrar_name || "AWS Route 53",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not found|not registered|InvalidInput|404/i.test(message)) return null;
        throw error;
      }
    },

    async ensureCloudflareZone(name) {
      const zone = await ensureZone(name, cloudflareConfig);
      return { id: zone.id, status: zone.status, nameservers: zone.nameservers };
    },

    async updateNameservers(
      name,
      nameservers,
      registrar: ProvisioningRegistrar = "route53",
    ) {
      if (registrar === "brandsight") {
        const provider = requireBrandsight();
        if (!provider.updateNameservers) {
          throw new RegistrarActionRequiredError("Brandsight nameserver updates are unavailable");
        }
        const result = await provider.updateNameservers(name, nameservers);
        if (!result.success) {
          throw new Error("Brandsight nameserver update was not accepted");
        }
        return {
          operationId: result.operationId || `brandsight:completed:${name}`,
          completed: true,
        };
      }
      return updateNameservers(name, nameservers);
    },

    async resolvePublicNameservers(name) {
      return dns.resolveNs(name).catch(() => [] as string[]);
    },

    async preserveRegistrarDnsBeforeDelegation(input) {
      const registrar = input.registrar === "brandsight" ? requireBrandsight() : route53;
      const registrarRecords = await registrar.getDnsRecords(input.hostname);
      if (input.registrar === "route53" && registrarRecords.length === 0) {
        throw new RegistrarActionRequiredError(
          "Route 53 has no readable hosted-zone records to preserve before delegation",
        );
      }
      const source = canonicalDelegationRecords(
        registrarRecords,
        input.hostname,
      );
      await reconcileRecords(input.zoneId, source.map((record) => ({
        type: record.type,
        name: record.name,
        content: record.value,
        ttl: record.ttl,
        ...(record.priority === null ? {} : { priority: record.priority }),
        ...(["A", "AAAA", "CNAME"].includes(record.type) ? { proxied: false } : {}),
      })), cloudflareConfig);
      const expectedGroups = new Set(source.map((record) => `${record.type}|${record.name}`));
      const readback = canonicalDelegationRecords(
        (await listRecords(input.zoneId, cloudflareConfig))
          .filter((record) => expectedGroups.has(`${record.type.toUpperCase()}|${record.name.toLowerCase().replace(/\.$/u, "")}`))
          .map((record) => ({
            type: record.type,
            name: record.name,
            value: record.content,
            ttl: record.ttl,
            priority: record.priority,
          })),
        input.hostname,
      );
      if (JSON.stringify(readback) !== JSON.stringify(source)) {
        throw new RegistrarActionRequiredError("Cloudflare DNS readback does not match the registrar DNS snapshot");
      }
      return { count: source.length, sha256: delegationRecordHash(source) };
    },

    async bindWorkerDomain(input) {
      await bindWorkerCustomDomain(input.hostname, input.zoneId, input.workerName, cloudflareConfig);
    },

    workerDomainReady(input) {
      return workerCustomDomainReady(input.hostname, input.zoneId, input.workerName, cloudflareConfig);
    },

    ensureWebsiteOriginTls(input) {
      return ensureZoneOriginTlsMode(input.zoneId, input.requestedMode, cloudflareConfig);
    },

    async configureWebsiteOrigin(input) {
      const records = [input.hostname, `www.${input.hostname}`].map((name) => ({
        type: "CNAME" as const,
        name,
        content: input.originHostname,
        proxied: true as const,
        ttl: 1,
      }));
      for (const record of records) {
        await deleteRecordByNameType(input.zoneId, record.name, "A", cloudflareConfig);
        await deleteRecordByNameType(input.zoneId, record.name, "AAAA", cloudflareConfig);
        await upsertRecord(input.zoneId, record, cloudflareConfig);
      }
      return records.map((record) => ({
        type: record.type,
        name: record.name,
        value: record.content,
        proxied: record.proxied,
        ttl: record.ttl,
      }));
    },

    async websiteOriginReady(input) {
      if (await getZoneOriginTlsMode(input.zoneId, cloudflareConfig) !== input.originTlsMode) {
        return false;
      }
      const records = await listRecords(input.zoneId, cloudflareConfig);
      const names = new Set([input.hostname, `www.${input.hostname}`]);
      const matching = records.filter((record) =>
        record.type === "CNAME"
        && names.has(record.name.toLowerCase().replace(/\.$/u, ""))
        && record.content.toLowerCase().replace(/\.$/u, "") === input.originHostname
        && record.proxied === true
      );
      if (matching.length !== names.size) return false;
      try {
        const signal = AbortSignal.timeout(10_000);
        const response = await fetch(`https://${input.hostname}/`, {
          method: "GET",
          redirect: "error",
          signal,
          headers: { "user-agent": "hasna-domains-provisioning/1" },
        });
        if (response.status !== 200 || !/^text\/html(?:;|$)/iu.test(response.headers.get("content-type") ?? "")) {
          return false;
        }
        const body = await boundedResponseText(response, 1_048_576, signal);
        const escapedHost = input.hostname.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        const canonical = new RegExp(
          `<link\\b(?=[^>]*\\brel=["'][^"']*\\bcanonical\\b[^"']*["'])(?=[^>]*\\bhref=["']https://${escapedHost}/?["'])[^>]*>`,
          "iu",
        );
        return canonical.test(body);
      } catch {
        return false;
      }
    },

    async reconcileDnsRecords(input) {
      await reconcileRecords(input.zoneId, input.records.map((record) => ({
        type: record.type,
        name: record.name,
        content: record.value,
        ttl: record.ttl,
        ...(record.priority === null ? {} : { priority: record.priority }),
        ...(record.type === "CNAME" ? { proxied: false } : {}),
      })), cloudflareConfig);
      return input.records;
    },

    async dnsRecordsReady(input) {
      const current = await listRecords(input.zoneId, cloudflareConfig);
      return input.records.every((expected) => current.some((record) =>
        record.type === expected.type
        && record.name.toLowerCase().replace(/\.$/u, "") === expected.name
        && record.content === expected.value
        && record.ttl === expected.ttl
        && (record.priority ?? null) === expected.priority
        && (expected.type !== "CNAME" || record.proxied === false)
      ));
    },

    async listRoute53HostedZoneIds(name) {
      return (await listHostedZonesByDomain(name)).map((zone) => zone.id).sort();
    },

    async cleanupRoute53HostedZone(input) {
      const cloudflare = await getZone(input.name, cloudflareConfig);
      if (!cloudflare || !nameserversEqual(cloudflare.nameservers, input.registrarNameservers)) return false;
      const result = await deleteDefaultHostedZone(
        input.hostedZoneId,
        input.name,
        input.registrarNameservers,
      );
      return result.deleted;
    },
  };
}
